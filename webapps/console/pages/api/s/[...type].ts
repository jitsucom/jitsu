import { getDataLocator, getReqEndpoint, StreamCredentials } from "../../../lib/domains";
import { Api, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { ApiError } from "../../../lib/shared/errors";
import { IngestMessage, IngestType } from "@jitsu/protocols/async-request";
import nodeFetch, { RequestInit } from "node-fetch-commonjs";
import { getServerLog } from "../../../lib/server/log";

import { checkHash, getErrorMessage, randomId, requireDefined } from "juava";
import { httpAgent, httpsAgent } from "../../../lib/server/http-agent";
import { AnalyticsClientEvent, AnalyticsContext, AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { fastStore, StreamWithDestinations } from "../../../lib/server/fast-store";
import { getCoreDestinationType } from "../../../lib/schema/destinations";
import { redis } from "../../../lib/server/redis";
import { Geo } from "@jitsu/protocols/analytics";
import { IncomingHttpHeaders } from "http";
import { NextApiRequest, NextApiResponse } from "next";
import jsondiffpatch from "jsondiffpatch";
import {
  CommonDestinationCredentials,
  satisfyDomainFilter,
  satisfyFilter,
} from "@jitsu/js/compiled/src/destination-plugins";
import { isEU } from "../../../lib/shared/countries";

const jsondiffpatchInstance = jsondiffpatch.create({});

function isInternalHeader(headerName: string) {
  return headerName.toLowerCase().startsWith("x-jitsu-") || headerName.toLowerCase().startsWith("x-vercel");
}

type HttpError = Error & { status?: number; body?: any };

const bulkerURLDefaultRetryTimeout = 100;
const bulkerURLDefaultRetryAttempts = 3;

const log = getServerLog("ingest-api");

export function applyFilters(event: AnalyticsClientEvent, creds: CommonDestinationCredentials): boolean {
  const { hosts = "*", events = "*" } = creds;
  try {
    const eventsArray = Array.isArray(events) ? events : events.split("\n");
    const hostsArray = Array.isArray(hosts) ? hosts : hosts.split("\n");
    return (
      !!hostsArray.find(hostFilter => satisfyDomainFilter(hostFilter, event.context?.page?.host)) &&
      (!!eventsArray.find(eventFilter => satisfyFilter(eventFilter, event.type)) ||
        !!eventsArray.find(eventFilter => satisfyFilter(eventFilter, event.event)))
    );
  } catch (e: any) {
    console.warn(
      `Failed to apply filters: ${e.message}. Typeof events: ${typeof events}, typeof hosts: ${typeof hosts}. Values`,
      events,
      hosts
    );
    throw new Error(
      `Failed to apply filters: ${e.message}. Typeof events: ${typeof events}, typeof hosts: ${typeof hosts}`
    );
  }
}

type StreamLocator = (loc: StreamCredentials) => Promise<StreamWithDestinations | undefined>;

const WriteKeyStreamLocator: StreamLocator = async loc => {
  if (loc.writeKey) {
    const [keyId, keySecret] = loc.writeKey.split(":");
    if (!keySecret) {
      //stream id is used as key
      return await fastStore.getStreamById(keyId);
    } else {
      const stream = await fastStore.getStreamByKeyId(keyId);
      if (stream) {
        if (loc.ingestType !== stream.keyType) {
          log.atError().log(`Invalid key type: found ${stream.keyType}, expected ${loc.ingestType}`);
        } else if (!checkHash(stream.hash, keySecret)) {
          log.atError().log(`Invalid key secret`);
        } else {
          return await fastStore.getStreamById(stream.streamId);
        }
      }
    }
  }
};

const SlugStreamLocator: StreamLocator = async loc => {
  if (loc.slug) {
    return await fastStore.getStreamById(loc.slug);
  }
};

const DomainStreamLocator: StreamLocator = async loc => {
  if (loc.domain) {
    const streams = (await fastStore.getStreamsByDomain(loc.domain)) || [];
    if (streams.length == 1) {
      return streams[0];
    } else if (streams.length > 1 && !loc.writeKey) {
      return streams[0];
    }
  }
};

const AmbiguousDomainStreamLocator: StreamLocator = async loc => {
  if (loc.domain) {
    const streams = (await fastStore.getStreamsByDomain(loc.domain)) || [];
    if (streams.length > 0) {
      return streams[0];
    }
  }
};

async function getStream(loc: StreamCredentials): Promise<StreamWithDestinations | undefined> {
  const locators =
    loc.ingestType === "s2s"
      ? [WriteKeyStreamLocator, SlugStreamLocator, AmbiguousDomainStreamLocator]
      : [SlugStreamLocator, DomainStreamLocator, WriteKeyStreamLocator];
  for (const locator of locators) {
    const stream = await locator(loc);
    if (stream) {
      return stream;
    }
  }
}

function asString(httpHeader?: string | string[]): string | undefined {
  return httpHeader ? (Array.isArray(httpHeader) ? httpHeader[0] : httpHeader) : undefined;
}

function fromHeaders(httpHeaders: IncomingHttpHeaders): Geo {
  const country = asString(httpHeaders["x-vercel-ip-country"]);
  const region = asString(httpHeaders["x-vercel-ip-country-region"]);
  const city = asString(httpHeaders["x-vercel-ip-city"]);
  const lat = asString(httpHeaders["x-vercel-ip-latitude"]);
  const lon = asString(httpHeaders["x-vercel-ip-longitude"]);
  return {
    country: country
      ? {
          code: country,
          isEU: isEU(country),
        }
      : undefined,
    city: city ? { name: city } : undefined,
    region: region ? { code: region } : undefined,
    location: lat && lon ? { latitude: parseFloat(lat), longitude: parseFloat(lon) } : undefined,
  };
}

/**
 * Builds response if any sync destination is connected to a stream
 */
async function buildResponse(message: IngestMessage, stream: StreamWithDestinations): Promise<any> {
  const dsts = await Promise.all(
    (stream.synchronousDestinations || []).map(async d => {
      let newEvents: any[] | undefined = undefined;
      if (!applyFilters(message.httpPayload, d.options)) {
        return null;
      }
      if (d.options.functions && d.options.functions.length > 0) {
        try {
          const rotorURL = requireDefined(
            process.env.ROTOR_URL,
            `env ROTOR_URL is not set. Rotor is required to run functions`
          );
          const controller = new AbortController();
          setTimeout(() => {
            controller.abort();
          }, parseInt(process.env.DEVICE_FUNCTIONS_TIMEOUT_MS ?? "200"));
          const res = await nodeFetch(rotorURL + "/func", {
            method: "POST",
            body: JSON.stringify({ ...message, connectionId: d.connectionId }),
            agent: (rotorURL.startsWith("https://") ? httpsAgent : httpAgent)(),
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
            },
          });
          if (res.status === 200) {
            const json = await res.json();
            newEvents = json as any[];
          } else if (res.status === 204) {
            //drop
            return null;
          }
        } catch (e) {
          log
            .atError()
            .withCause(e)
            .log(`Failed to run device functions. connectionId: ${message.connectionId}: ${getErrorMessage(e)}`);
        }
      }
      const deviceOptions: any =
        requireDefined(getCoreDestinationType(d.destinationType), `Unknown destination ${d.destinationType}`)
          .deviceOptions || {};
      return {
        ...d,
        newEvents: newEvents
          ? newEvents.map(e => (jsondiffpatchInstance.diff(message.httpPayload, e) == null ? "same" : e))
          : undefined,
        deviceOptions,
      };
    })
  );
  return {
    destinations: dsts.filter(d => d !== null),
  };
}

export function setResponseHeaders({ req, res }: { req: NextApiRequest; res: NextApiResponse }) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-enable-debug, x-write-key, authorization, content-type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

export async function sendEventToBulker(req: NextApiRequest, ingestType: IngestType, event: AnalyticsServerEvent) {
  const bulkerAuthKey = process.env.BULKER_AUTH_KEY ?? "";
  const bulkerURLEnv: string | undefined = (process.env.BULKER_URL as string) || undefined;
  const bulkerURLRetryAttempts = process.env.BULKER_URL_RETRY_ATTEMPTS
    ? parseInt(process.env.BULKER_URL_RETRY_ATTEMPTS)
    : bulkerURLDefaultRetryAttempts;
  const bulkerURLRetryTimeoutMs = process.env.BULKER_URL_RETRY_TIMEOUT_MS
    ? parseInt(process.env.BULKER_URL_RETRY_TIMEOUT_MS)
    : bulkerURLDefaultRetryTimeout;
  const isHttps = !!bulkerURLEnv && bulkerURLEnv.startsWith("https://");

  const loc = getDataLocator(req, ingestType, event);
  const type = event.type;
  const message: IngestMessage = {
    //getting geo make sense only for browser events, otherwise it will based on ip of a server
    geo: ingestType === "browser" ? fromHeaders(req.headers) : {},
    connectionId: "",

    ingestType,
    messageCreated: new Date().toISOString(),
    messageId: event.messageId,
    writeKey: loc.writeKey ?? "",
    type,

    origin: {
      baseUrl: getReqEndpoint(req).baseUrl,
      slug: loc.slug,
      domain: loc.domain,
    },
    httpHeaders: Object.entries(req.headers)
      .filter(([k, v]) => v !== undefined && v !== null && !isInternalHeader(k))
      .map(
        ([k, v]) =>
          (k.toLowerCase() === "x-write-key" ? [k, maskWriteKey(`${v}`)] : [k, v]) as [
            string,
            string | string[] | undefined
          ]
      )
      .map(([k, v]) => [k, typeof v === "string" ? v : (v as string[]).join(",")])
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
    httpPayload: event,
  };

  log.atDebug().log(`Sending to bulker: ${JSON.stringify(message, null, 2)}`);
  const payload = JSON.stringify(message);
  // Options object
  const options = {
    method: "POST",
    agent: (isHttps ? httpsAgent : httpAgent)(),
    headers: {
      "Content-Type": "application/json",
    },
  };
  if (bulkerAuthKey) {
    options.headers["Authorization"] = `Bearer ${bulkerAuthKey}`;
  }
  try {
    let bulkerPromise;
    let response: any;
    let stream: StreamWithDestinations | undefined;
    try {
      stream = await getStream(loc);
      message.streamId = stream?.stream.id;
      if (stream) {
        if (stream.asynchronousDestinations?.length > 0 || stream.synchronousDestinations?.length > 0) {
          response = await buildResponse(message, stream);
        } else {
          const msg = `No destinations linked for stream: ${stream.stream.id}`;
          log.atWarn().log(msg);
          response = { ok: false, error: msg };
        }
      } else {
        const msg = `Source not found for ${JSON.stringify(loc)}`;
        log.atWarn().log(msg);
        response = { ok: false, error: msg };
      }
    } catch (e) {
      const msg = `Failed to get stream for ${JSON.stringify(loc)}: ${getErrorMessage(e)}`;
      log.atWarn().withCause(e).log(msg);
      response = { ok: false, error: msg };
    }
    if (bulkerURLEnv) {
      const injestUrl = bulkerURLEnv + "/ingest";
      bulkerPromise = httpRequest(
        event.messageId,
        injestUrl,
        options,
        { retryAttempts: bulkerURLRetryAttempts, retryTimeoutMs: bulkerURLRetryTimeoutMs },
        payload
      ).then(response =>
        log
          .atDebug()
          .log(
            `Event ID: ${type} / ${event.messageId} sent to bulker: ${injestUrl}. Response: ${JSON.stringify(
              response
            )} `
          )
      );
      if (stream?.backupEnabled) {
        const backupUrl = `${bulkerURLEnv}/post/${stream.stream.workspaceId}_backup?tableName=backup`;
        bulkerPromise = bulkerPromise
          .then(() =>
            httpRequest(
              event.messageId,
              backupUrl,
              options,
              { retryAttempts: bulkerURLRetryAttempts, retryTimeoutMs: bulkerURLRetryTimeoutMs },
              payload
            )
          )
          .then(response =>
            log
              .atDebug()
              .log(
                `Event ID: ${type} / ${event.messageId} sent to backup: ${backupUrl}. Response: ${JSON.stringify(
                  response
                )} `
              )
          );
      }
    } else {
      bulkerPromise = Promise.resolve(undefined);
      log
        .atWarn()
        .log(`Bulker is not connected (BULKER_URL is not set). Request dump: ${JSON.stringify(message, null, 2)}`);
    }

    const waitForBulker = req.query.sync as string;
    if (waitForBulker === "true" || waitForBulker === "1") {
      await bulkerPromise;
    } else {
      bulkerPromise.catch(e => {
        log
          .atError()
          .withCause(e)
          .log(`Failed to send event to bulker: ${getErrorMessage(e)}`);
      });
    }

    if (response) {
      return response;
    } else {
      return { ok: true };
    }
  } catch (e: any) {
    const errorMessage = `Failed to process event with ID ${event.messageId}: ${getErrorMessage(e)}`;
    log.atDebug().withCause(e).log(errorMessage);
    if (e.status && e.body) {
      throw new ApiError(errorMessage, e.body, { status: e.status });
    } else {
      throw new ApiError(errorMessage, undefined, { status: 500 });
    }
  }
}

export function patchEvent(
  event: AnalyticsServerEvent,
  type: string,
  req: NextApiRequest,
  ingestType: "s2s" | "browser",
  context?: AnalyticsContext
) {
  let typeFixed =
    {
      p: "page",
      i: "identify",
      t: "track",
      g: "group",
      a: "alias",
      s: "screen",
      e: "event",
    }[type] || type;

  if (typeFixed === "event") {
    typeFixed = requireDefined(event.type, `type property of event is required`);
  }

  event.request_ip =
    (req.headers["x-real-ip"] as string) || (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress;

  //make sure that context is initialized
  event.context = event.context || {};

  if (ingestType === "browser") {
    //if ip comes from browser, don't trust it!
    event.context.ip = event.request_ip;
    //get geo from headers, so we can display it in the console
    //we do it only for calls fron browser, otherwise it's pointless, the geo
    //will contain ip of the server
    event.context.geo = fromHeaders(req.headers);
  }
  if (context) {
    event.context = { ...context, ...event.context };
  }
  if (!event.context.userAgent) {
    event.context.userAgent = req.headers["user-agent"] as string;
  }
  if (!event.context.locale) {
    event.context.locale = (req.headers["accept-language"] as string | undefined)?.split(",")[0]?.trim() || undefined;
  }

  const nowIsoDate = new Date().toISOString();
  event.receivedAt = nowIsoDate;
  event.type = typeFixed as any;
  if (!event.timestamp) {
    event.timestamp = nowIsoDate;
  }
  if (!event.messageId) {
    event.messageId = randomId();
  }

  if (!["page", "identify", "track", "group", "alias", "screen"].includes(typeFixed)) {
    throw new ApiError(`Unknown event type: ${type}`, undefined, { status: 404 });
  }
}

const api: Api = {
  OPTIONS: {
    auth: false,
    types: {
      body: z.any(),
    },
    handle: async ({ res, req }) => {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Access-Control-Allow-Methods", "*");
      res.setHeader("Access-Control-Allow-Headers", "x-enable-debug, x-write-key, authorization, content-type");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      //res.setHeader("Vary", "Origin");
      return;
    },
  },
  POST: {
    auth: false,
    types: {
      body: z.any(),
    },
    handle: async ({ body, req, res }) => {
      const contentType = req.headers["content-type"];
      if (contentType && contentType !== "application/json") {
        throw new ApiError(`Invalid content type: ${contentType}. Expected: application/json`, undefined, {
          status: 400,
        });
      }
      //make sure that redis is initialized
      await redis.waitInit();
      //TODO validate event messageId, timestamp

      const args = Array.isArray(req.query.type) ? req.query.type : [req.query.type];
      const [prefix, ...rest] = args;

      const type: string = prefix === "s2s" ? rest.join("") : args.join("");
      const ingestType: IngestType = prefix === "s2s" ? "s2s" : "browser";

      const event = body as AnalyticsServerEvent;
      patchEvent(event, type, req, ingestType);
      setResponseHeaders({ res, req });
      return await sendEventToBulker(req, ingestType, event);
    },
  },
};

function httpRequest(
  messageId: string,
  url: string,
  options: RequestInit,
  retries: { retryAttempts?: number; retryTimeoutMs?: number; _totalAttempts?: number },
  payload?: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    // totalAttempts = initialAttempt + retries
    retries._totalAttempts = retries._totalAttempts ?? (retries.retryAttempts ?? 0) + 1;
    const attemptN = retries._totalAttempts - (retries.retryAttempts ?? 0);
    const retryRequest = error => {
      if (retries.retryAttempts) {
        const rtrs = {
          ...retries,
          retryAttempts: retries.retryAttempts - 1,
        };
        const timeout = Math.pow(2, attemptN - 1) * (retries.retryTimeoutMs ?? bulkerURLDefaultRetryTimeout);
        log
          .atError()
          .withCause(error)
          .log(
            `ID: ${messageId} Error while sending request to bulker (${url}): ${getErrorMessage(
              error
            )}. Attempt ${attemptN} of ${rtrs._totalAttempts}. Retrying in ${timeout}ms...`
          );
        setTimeout(() => {
          httpRequest(messageId, url, options, rtrs, payload).then(resolve, reject);
        }, timeout);
      } else {
        log
          .atError()
          .withCause(error)
          .log(
            `ID: ${messageId} Error while sending request to bulker. Attempt ${attemptN} of ${retries._totalAttempts}.`
          );
        reject(error);
      }
    };

    options.body = payload;

    nodeFetch(url, options)
      .then(response => {
        if (response.ok) {
          response
            .text()
            .then(json => {
              log
                .atDebug()
                .log(
                  `ID: ${messageId} StatusCode: ${response.status} Response Body: ${json}  (Attempt ${attemptN} of ${retries._totalAttempts})`
                );
              resolve(json);
            })
            .catch(retryRequest);
        } else {
          response
            .text()
            .then(json => {
              if (response.status === 500) {
                retryRequest(new Error(`HTTP error: ${response.status} body: ${json}`));
              } else {
                try {
                  const e = JSON.parse(json);
                  log
                    .atError()
                    .log(
                      `ID: ${messageId} Error while sending request to bulker (${url}): Known error: ${e.error}. Not retrying.`
                    );
                } catch (e) {
                  retryRequest(new Error(`HTTP error: ${response.status} body: ${json}`));
                }
              }
            })
            .catch(retryRequest);
        }
      })
      .catch(retryRequest);
  });
}

function maskWriteKey(writeKey?: string): string | undefined {
  if (writeKey) {
    const [id, secret] = writeKey.split(":", 2);
    if (secret) {
      return `${id}:***`;
    } else {
      return "***";
    }
  }
  return writeKey;
}

export default nextJsApiHandler(api);
