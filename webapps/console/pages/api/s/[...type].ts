import { getDataLocator, getReqEndpoint, StreamLocator } from "../../../lib/domains";
import { Api, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { ApiError } from "../../../lib/shared/errors";
import { IngestMessage, IngestType } from "@jitsu/protocols/async-request";
import nodeFetch, { RequestInit } from "node-fetch-commonjs";
import { getServerLog } from "../../../lib/server/log";

import { checkHash, getErrorMessage, randomId, requireDefined } from "juava";
import { httpAgent, httpsAgent } from "../../../lib/server/http-agent";
import { AnalyticsContext, AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { fastStore, StreamWithDestinations } from "../../../lib/server/fast-store";
import { getCoreDestinationType } from "../../../lib/schema/destinations";
import { redis } from "../../../lib/server/redis";
import { Geo } from "@jitsu/protocols/functions";
import { isEU } from "../../../lib/shared/eu";
import { IncomingHttpHeaders } from "http";
import { NextApiRequest, NextApiResponse } from "next";

function isInternalHeader(headerName: string) {
  return headerName.toLowerCase().startsWith("x-jitsu-") || headerName.toLowerCase().startsWith("x-vercel");
}

type HttpError = Error & { status?: number; body?: any };

const bulkerURLDefaultRetryTimeout = 100;
const bulkerURLDefaultRetryAttempts = 3;

const log = getServerLog("ingest-api");

async function getStream(loc: StreamLocator): Promise<StreamWithDestinations | undefined> {
  if (loc.writeKey) {
    const [keyId, keySecret] = loc.writeKey.split(":");
    if (!keySecret) {
      //stream id is used as key
      return await fastStore.getStreamById(keyId);
    } else {
      const stream = await fastStore.getStreamByKeyId(keyId);
      if (stream) {
        if (loc.keyType !== stream.keyType) {
          throw new Error(`Invalid key type: found ${stream.keyType}, expected ${loc.keyType}`);
        }
        if (!checkHash(stream.hash, keySecret)) {
          throw new Error(`Invalid key secret`);
        }
        return await fastStore.getStreamById(stream.streamId);
      }
      {
        return undefined;
      }
    }
  } else if (loc.slug) {
    return await fastStore.getStreamById(loc.slug);
  } else if (loc.domain) {
    const streams = (await fastStore.getStreamsByDomain(loc.domain)) || [];
    if (streams.length == 1) {
      return streams[0];
    } else if (streams.length > 1) {
      throw new Error(`Multiple streams found for domain ${loc.domain}`);
    } else {
      return undefined;
    }
  } else {
    return undefined;
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
function buildResponse(baseUrl: string, stream: StreamWithDestinations): any {
  return {
    destinations: (stream.synchronousDestinations || []).map(d => {
      const deviceOptions: any =
        requireDefined(getCoreDestinationType(d.destinationType), `Unknown destination ${d.destinationType}`)
          .deviceOptions || {};
      return {
        ...d,
        deviceOptions,
      };
    }),
  };
}

export function setResponseHeaders({ req, res }: { req: NextApiRequest; res: NextApiResponse }) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-enable-debug, x-write-key, authorization, content-type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

export async function sendEventToBulker(
  req: NextApiRequest,
  ingestType: "s2s" | "browser",
  event: AnalyticsServerEvent
) {
  const bulkerAuthKey = process.env.BULKER_AUTH_KEY ?? "";
  const bulkerURLEnv: string | undefined = (process.env.BULKER_URL as string) || undefined;
  const bulkerURLRetryAttempts = process.env.BULKER_URL_RETRY_ATTEMPTS
    ? parseInt(process.env.BULKER_URL_RETRY_ATTEMPTS)
    : bulkerURLDefaultRetryAttempts;
  const bulkerURLRetryTimeoutMs = process.env.BULKER_URL_RETRY_TIMEOUT_MS
    ? parseInt(process.env.BULKER_URL_RETRY_TIMEOUT_MS)
    : bulkerURLDefaultRetryTimeout;
  const isHttps = !!bulkerURLEnv && bulkerURLEnv.startsWith("https://");

  const { slug, domain, writeKey } = getDataLocator(req, ingestType, event);
  const type = event.type;
  const message: IngestMessage = {
    geo: fromHeaders(req.headers),
    connectionId: "",
    ingestType,
    messageCreated: new Date().toISOString(),
    messageId: event.messageId,
    writeKey: writeKey ?? "",
    type,

    origin: {
      baseUrl: getReqEndpoint(req).baseUrl,
      slug,
      domain,
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
    const loc = {
      slug,
      domain,
      writeKey,
      keyType: ingestType,
    } as StreamLocator;
    try {
      stream = await getStream(loc);
      if (stream) {
        response = buildResponse(message.origin.baseUrl, stream);
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

  if (ingestType === "browser") {
    event.context = event.context || {};
    event.context.ip = event.request_ip;
  }
  if (context) {
    event.context = { ...context, ...event.context };
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
              retryRequest({
                ...new Error(`HTTP error: ${response.status} body: ${json}`),
                status: response.status,
                body: json,
              } as HttpError);
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
