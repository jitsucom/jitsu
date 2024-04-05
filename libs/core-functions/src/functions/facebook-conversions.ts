import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent, ID } from "@jitsu/protocols/analytics";
import { FacebookConversionApiCredentials } from "../meta";

import crypto from "crypto";
import omit from "lodash/omit";
import { RetryError } from "@jitsu/functions-lib";
import { createFetchWrapper, createFilter, createFunctionLogger, eventTimeSafeMs, JitsuFunctionWrapper } from "./lib";

export function facebookHash(email: string) {
  return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
}

function reduceArray(strings: ID[]): ID[] | ID {
  return strings.length === 1 ? strings[0] : strings;
}

function sanitizeEmail(em: string) {
  return em.trim().toLowerCase();
}

function tryParse(responseText: string) {
  try {
    return JSON.parse(responseText);
  } catch (e) {
    return responseText;
  }
}

function toPrettyString(responseJson: any) {
  return typeof responseJson === "string" ? responseJson : JSON.stringify(responseJson, null, 2);
}

/**
 * See https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api
 * and https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
 */
const FacebookConversionsApi: JitsuFunctionWrapper<AnalyticsServerEvent, FacebookConversionApiCredentials> = (
  chainCtx,
  funcCtx
) => {
  const log = createFunctionLogger(chainCtx, funcCtx);
  const fetch = createFetchWrapper(chainCtx, funcCtx);
  const props = funcCtx.props;

  const func: JitsuFunction<AnalyticsServerEvent> = async (event, ctx) => {
    if (event.type === "track" || event.type === "page" || event.type === "screen") {
      const filter = createFilter(props.events || "");
      if (!filter(event.type, event.event)) {
        return;
      }

      const fbEvent = {
        event_name: event.type === "track" ? event.event : event.type,
        event_time: Math.floor(eventTimeSafeMs(event) / 1000),
        event_id: event.messageId,
        action_source: props?.actionSource || "website",
        event_source_url: event.context?.page?.url,
        user_data: {
          em: event.context.traits?.email ? facebookHash(sanitizeEmail(event.context.traits.email + "")) : undefined,
          //ph: "" - phone number hash. We don't have a predefined field for phone number. Should be configurable
          external_id: reduceArray([event.userId, event.anonymousId].filter(e => !!e)),
          client_ip_address: event.context.ip,
          client_user_agent: event.context.userAgent,
          fbc: event.context.clientIds?.fbc,
          fbp: event.context.clientIds?.fbp,
        },
        custom_data: omit(event.properties, [
          "path",
          "referrer",
          "host",
          "referring_domain",
          "search",
          "title",
          "url",
          "hash",
          "height",
          "width",
        ]),
      };

      const baseUrl = `https://graph.facebook.com/v18.0/${props.pixelId}/events?access_token=`;
      const payload = { data: [fbEvent] };
      const fetchResult = await fetch(
        `${baseUrl}${props.accessToken}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        { event }
      );
      const responseText = await fetchResult.text();
      const responseJson = tryParse(responseText);
      log.debug(
        `Facebook API - ${baseUrl}**** ---------> ${fetchResult.status} ${fetchResult.statusText}:\n${toPrettyString(
          responseJson
        )}`
      );
      if (!fetchResult.ok) {
        throw new RetryError(
          `Facebook API error. Called: ${baseUrl}****, got ${fetchResult.status} ${fetchResult.statusText} - ${responseText}`
        );
      }
    }
  };

  func.displayName = "facebook-conversion-api";

  func.description = "Send events to facebook conversion API";

  return func;
};

export default FacebookConversionsApi;
