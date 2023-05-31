import { JitsuFunction } from "@jitsu/protocols/functions";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { JuneCredentials } from "../meta";

export type HttpRequest = {
  method?: string;
  url: string;
  payload?: any;
  headers?: Record<string, string>;
};

function prefix<P extends string = string>(param: Record<any, string>, prefix: P): Record<string, any> {
  return Object.entries(param).reduce((acc, [key, value]) => ({ ...acc, [`${prefix}${key}`]: value }), {});
}

function filter(obj: Record<string, any>, ...keys: string[]) {
  return Object.entries(obj).reduce((acc, [key, value]) => (keys.includes(key) ? acc : { ...acc, [key]: value }), {});
}

function trackEvent(event: AnalyticsServerEvent): any {
  const groupId = event.context?.groupId;
  return {
    type: "track",
    event: event.type === "page" ? "Page View" : event.event,
    timestamp: event.timestamp,
    anonymousId: event.anonymousId,
    userId: event.userId,
    email: event.context?.traits?.email,
    properties: {
      ...filter(event.properties || {}, "width", "height"),
      referrer: event.context?.referrer,
      referring_domain: event.context?.referring_domain,
      ...prefix(event.context?.campaign || {}, "campaign_"),
      ip: event.request_ip,
      userAgent: event.context?.userAgent,
      locale: event.context?.locale,
      ...prefix(event.context?.screen || {}, "screen_"),
    },
    context: { ...(groupId ? { groupId } : {}) },
  };
}

function identifyEvent(event: AnalyticsServerEvent): any {
  const traits = { ...event.traits };
  // link is managed by group event
  delete traits.groupId;
  return {
    type: "identify",
    timestamp: event.timestamp,
    anonymousId: event.anonymousId,
    userId: event.userId,
    traits: traits,
  };
}

function groupEvent(event: AnalyticsServerEvent): any {
  return {
    type: "group",
    timestamp: event.timestamp,
    anonymousId: event.anonymousId,
    userId: event.userId,
    groupId: event.groupId,
    traits: event.traits,
  };
}

const JuneDestination: JitsuFunction<AnalyticsServerEvent, JuneCredentials> = async (event, ctx) => {
  ctx.log.debug(`June destination (props=${JSON.stringify(ctx.props)}) received event ${JSON.stringify(event)}`);
  let httpRequest: HttpRequest | undefined = undefined;
  const headers = {
    "Content-type": "application/json",
    Authorization: `Basic ${ctx.props.apiKey}`,
  };
  if (event.type === "identify" && event.userId) {
    httpRequest = {
      url: `https://api.june.so/sdk/identify`,
      payload: identifyEvent(event),
      headers,
    };
  } else if (event.type === "group") {
    httpRequest = {
      url: `https://api.june.so/sdk/group`,
      payload: groupEvent(event),
      headers,
    };
  } else if (event.type === "track" || event.type === "page") {
    if (event.userId || ctx.props.enableAnonymousUserProfiles) {
      httpRequest = {
        url: `https://api.june.so/sdk/track`,
        payload: trackEvent(event),
        headers,
      };
    }
  }

  if (httpRequest) {
    const method = httpRequest.method || "POST";
    try {
      const result = await ctx.fetch(httpRequest.url, {
        method,
        headers: httpRequest.headers,
        ...(httpRequest.payload ? { body: JSON.stringify(httpRequest.payload) } : {}),
      });
      const logMessage = `June.so ${method} ${httpRequest.url}:${
        httpRequest.payload ? `${JSON.stringify(httpRequest.payload)} --> ` : ""
      }${result.status} ${await result.text()}`;
      if (result.status !== 200) {
        ctx.log.error(logMessage);
      } else {
        ctx.log.debug(logMessage);
      }
    } catch (e: any) {
      throw new Error(
        `Failed to send event to MixPanel: ${method} ${httpRequest.url} ${JSON.stringify(httpRequest.payload)}: ${
          e?.message
        }`
      );
    }
  }
};

JuneDestination.displayName = "june-destination";

JuneDestination.description = "This functions covers jitsu events and sends them to June";

export default JuneDestination;
