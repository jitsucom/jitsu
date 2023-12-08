import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { randomId } from "juava";

function createContext(url: string, traits?: Record<string, any>): any {
  const parsedUrl = new URL(url);
  return {
    app: {},
    campaign: {
      name: "name",
      source: "source",
    },
    ip: "99.177.205.92",
    library: {
      name: "Jitsu",
      version: "1.0",
    },
    locale: "en-US",
    os: {
      name: "",
      version: "",
    },
    traits: traits,
    page: {
      path: parsedUrl.pathname,
      referrer: "$direct",
      search: parsedUrl.search,
      title: `Title: ${parsedUrl.pathname}`,
      url: url,
    },
    screen: {
      density: 2,
      height: 2000,
      innerHeight: 1000,
      innerWidth: 2000,
      width: 1000,
    },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36",
  };
}

export const reservedEventNames = new Set(["page", "screen", "identify", "alias", "group", "track"]);

export function event(
  type: string,
  opts: {
    anonymousId?: string;
    url: string;
    userId?: string;
    groupId?: string;
    properties?: Record<string, any>;
    contextTraits?: Record<string, any>;
  }
): AnalyticsServerEvent {
  let [eventType, eventSubtype] = type.indexOf("/") > 0 ? type.split("/") : [type, undefined];
  if (!eventSubtype && !reservedEventNames.has(eventType)) {
    eventSubtype = eventType;
    eventType = "track";
  }
  return {
    type: eventType as any,
    event: eventSubtype,
    ...(opts.anonymousId ? { anonymousId: opts.anonymousId } : {}),
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
    channel: "web",
    context: createContext(opts.url, opts.contextTraits),
    properties: opts.properties || {},
    messageId: randomId(),
    originalTimestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    request_ip: "99.177.205.92",
    sentAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
  };
}

export function identify(opts: {
  anonymousId?: string;
  url: string;
  userId?: string;
  groupId?: string;
  traits?: Record<string, any>;
}): AnalyticsServerEvent {
  return {
    type: "identify",
    ...(opts.anonymousId ? { anonymousId: opts.anonymousId } : {}),
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
    channel: "web",
    traits: opts.traits || {},
    context: createContext(opts.url),
    messageId: randomId(),
    originalTimestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    request_ip: "99.177.205.92",
    sentAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
  };
}

export function group(opts: {
  anonymousId?: string;
  url?: string;
  userId?: string;
  groupId: string;
  traits?: Record<string, any>;
}): AnalyticsServerEvent {
  return {
    type: "group",
    ...(opts.anonymousId ? { anonymousId: opts.anonymousId } : {}),
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
    channel: "web",
    traits: opts.traits || {},
    context: createContext(opts.url),
    messageId: randomId(),
    originalTimestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    request_ip: "99.177.205.92",
    sentAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
  };
}

export function eventsSequence() {
  const traits = { email: "john.doe.1@gmail.com", name: "John Doe" };
  const events = [
    identify({ anonymousId: "anonymousId1", url: "https://jitsu.com?test=1" }),
    event("page", { anonymousId: "anonymousId1", url: "https://jitsu.com?test=1" }),
    event("page", { anonymousId: "anonymousId1", url: "https://jitsu.com/signup" }),
    identify({ anonymousId: "anonymousId1", url: "https://jitsu.com?test=1", userId: "userId", traits }),
    event("page", { anonymousId: "anonymousId1", userId: "userId1", url: "https://app.jitsu.com" }),
    event("track/signup", { anonymousId: "anonymousId", userId: "userId1", url: "https://app.jitsu.com" }),
  ];
  return events;
}
