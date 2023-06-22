import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { tagPlugin } from "./tag";
import { logrocketPlugin } from "./logrocket";
import { gtmPlugin } from "./gtm";

export type InternalPlugin<T> = {
  id: string;
  handle(config: T, payload: AnalyticsClientEvent): Promise<void>;
};

export type CommonDestinationCredentials = {
  hosts?: string;
  events?: string;
};

export function satisfyFilter(filter: string, subject: string | undefined): boolean {
  return filter === "*" || filter.toLowerCase().trim() === (subject || "").trim().toLowerCase();
}

export function satisfyDomainFilter(filter: string, subject: string | undefined): boolean {
  if (filter === "*") {
    return true;
  }
  subject = subject || "";

  if (filter.startsWith("*.")) {
    return subject.endsWith(filter.substring(1));
  } else {
    return filter === subject;
  }
}

export function applyFilters(event: AnalyticsClientEvent, creds: CommonDestinationCredentials): boolean {
  const { hosts = "*", events = "*" } = creds;
  try {
    const eventsArray = Array.isArray(events) ? events : events.split("\n");
    const hostsArray = Array.isArray(hosts) ? hosts : hosts.split("\n");
    return (
      !!hostsArray.find(hostFilter => satisfyDomainFilter(hostFilter, event.context?.host)) &&
      (!!eventsArray.find(eventFilter => satisfyFilter(eventFilter, event.type)) ||
        !!eventsArray.find(eventFilter => satisfyFilter(eventFilter, event.event)))
    );
  } catch (e) {
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

export const internalDestinationPlugins: Record<string, InternalPlugin<any>> = {
  [tagPlugin.id]: tagPlugin,
  [gtmPlugin.id]: gtmPlugin,
  [logrocketPlugin.id]: logrocketPlugin,
};
