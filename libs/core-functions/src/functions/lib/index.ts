import {
  AnalyticsClientEvent,
  AnalyticsServerEvent,
  PageReservedProps,
  ProcessingContext,
  ServerContextReservedProps,
} from "@jitsu/protocols/analytics";
import { AnonymousEventsStore, EventsStore, TTLStore } from "@jitsu/protocols/functions";

export type MetricsMeta = {
  workspaceId: string;
  messageId: string;
  streamId: string;
  destinationId: string;
  connectionId: string;
  functionId?: string;
  retries?: number;
};

/**
 * Function execution context available for built-in functions only
 */
export type SystemContext = {
  $system: {
    anonymousEventsStore: AnonymousEventsStore;
    metricsMeta: MetricsMeta;
    store: TTLStore;
    eventsStore: EventsStore;
  };
};

type KnownEventKeys = keyof Required<AnalyticsClientEvent & ServerContextReservedProps & ProcessingContext>;
//to make sure we
const knownProps: Record<keyof Required<AnalyticsClientEvent & ServerContextReservedProps & ProcessingContext>, true> =
  {
    $table: true,
    anonymousId: true,
    category: true,
    context: true,
    event: true,
    groupId: true,
    messageId: true,
    name: true,
    previousId: true,
    properties: true,
    receivedAt: true,
    requestIp: true,
    sentAt: true,
    timestamp: true,
    traits: true,
    type: true,
    userId: true,
    writeKey: true,
  };

const knownPageProps: Record<keyof Required<PageReservedProps>, true> = {
  path: true,
  host: true,
  referrer: true,
  referring_domain: true,
  search: true,
  title: true,
  url: true,
};

export function getEventCustomProperties(
  event: AnalyticsServerEvent,
  opts?: { exclude?: (obj: Record<string, any>) => void }
) {
  const res: Record<string, any> = {};
  for (const prop in event) {
    if (!knownProps[prop]) {
      res[prop] = event[prop];
    }
  }
  for (const prop in event.context.page || {}) {
    if (!knownPageProps[prop]) {
      res[prop] = event[prop];
    }
  }
  const props = { ...res, ...(event.properties || {}), ...(event.context || {}) };
  if (opts?.exclude) {
    opts.exclude(props);
  }
  return props;
}

export function getTraits(event: AnalyticsServerEvent) {
  return { ...(event.traits || {}), ...(event.context?.traits || {}) };
}

export function createFilter(filter: string): (eventType: string, eventName?: string) => boolean {
  if (filter === "*") {
    return () => true;
  } else if (filter === "") {
    return eventType => eventType !== "page" && eventType !== "screen";
  } else {
    const events = filter.split(",").map(e => e.trim());
    return (eventType: string, eventName?: string) => {
      return events.includes(eventType) || (!!eventName && events.includes(eventName));
    };
  }
}

export function eventTimeSafeMs(event: AnalyticsServerEvent) {
  const now = new Date().getTime();
  const ts = event.timestamp ? new Date(event.timestamp as string).getTime() : NaN;
  const receivedAt = event.receivedAt ? new Date(event.receivedAt as string).getTime() : NaN;
  return Math.min(!isNaN(ts) ? ts : now, !isNaN(receivedAt) ? receivedAt : now, now);
}
