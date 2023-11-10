import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { FacebookConversionApiCredentials } from "../meta";

import crypto from "crypto";
import { sanitize } from "juava";

function createFilter(filter: string): (eventName: string, eventType: string) => boolean {
  if (filter === "*") {
    return () => true;
  } else if (filter === "") {
    return eventName => eventName !== "page" && eventName !== "screen";
  } else {
    const events = filter.split(",").map(e => e.trim());
    return (eventName: string, eventType: string) => {
      return events.includes(eventName) || events.includes(eventType);
    };
  }
}

export function facebookHash(email: string) {
  return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
}

function reduceArray(strings: string[]): string[] | string {
  return strings.length === 1 ? strings[0] : strings;
}

function sanitizeEmail(em: string) {
  return em.trim().toLowerCase();
}

/**
 * See https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api
 * and https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
 */
const FacebookConversionsApi: JitsuFunction<AnalyticsServerEvent, FacebookConversionApiCredentials> = async (
  event,
  ctx
) => {
  if (event.type === "track" || event.event === "page" || event.event === "screen") {
    const filter = createFilter(ctx.props.events || "");
    if (!filter(event.event, event.type)) {
      return;
    }

    const fbEvent = {
      event_name: event.type === "track" ? event.event : event.type,
      event_time: Math.floor((event.timestamp ? new Date(event.timestamp) : new Date()).getTime() / 1000),
      user_data: {
        em: event.context.traits?.email ? facebookHash(sanitizeEmail(event.context.traits.email + "")) : undefined,
        //ph: "" - phone number hash. We don't have a predefined field for phone number. Should be configurable
        external_id: reduceArray([event.userId, event.anonymousId].filter(e => !!e)),
        client_ip_address: event.context.ip,
        client_user_agent: event.context.userAgent,
        fbc: event.context.clientIds?.fbc,
        fbp: event.context.clientIds?.fbp,
      },
    };
  }
};

FacebookConversionsApi.displayName = "facebook-conversion-api";

FacebookConversionsApi.description = "Send events to facebook conversion API";

export default FacebookConversionsApi;
