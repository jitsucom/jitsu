import {
  AnalyticsClientEvent,
  AnalyticsServerEvent,
  PageReservedProps,
  ProcessingContext,
  ServerContextReservedProps,
} from "@jitsu/protocols/analytics";

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
    request_ip: true,
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
