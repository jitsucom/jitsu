import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { RetryError } from "@jitsu/functions-lib";
import { JsonFetchError } from "@jitsu/core-functions-lib";

// Shared helpers for "contact-sync" email destinations (Resend, SendGrid): connectors that turn Jitsu
// users into contacts keyed by email and manage audience/list membership. The per-destination files own
// the API-specific I/O; everything reusable and API-agnostic lives here.

// Merge identify traits (event.traits) over the ambient context.traits (which Jitsu attaches to every
// event); event traits win.
export function getTraits(event: AnalyticsServerEvent): Record<string, any> {
  return { ...(event.context?.traits || {}), ...(event.traits || {}) };
}

// Contacts are keyed by email in these destinations.
export function resolveEmail(event: AnalyticsServerEvent): string | undefined {
  const email = getTraits(event).email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}

// Parse a comma-separated string into a trimmed, de-duplicated list of names.
export function splitCsv(value: any): string[] {
  if (typeof value !== "string") {
    return [];
  }
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (trimmed) {
      seen.add(trimmed);
    }
  }
  return [...seen];
}

// first/last name from firstName/lastName (or snake_case first_name/last_name) traits, else split from
// a single `name` trait.
export function splitName(traits: Record<string, any>): { first_name?: string; last_name?: string } {
  const first = traits.firstName ?? traits.first_name;
  const last = traits.lastName ?? traits.last_name;
  if (first || last) {
    return { first_name: first, last_name: last };
  }
  if (typeof traits.name === "string" && traits.name.trim()) {
    const [firstFromName, ...rest] = traits.name.trim().split(/\s+/);
    return { first_name: firstFromName, last_name: rest.length ? rest.join(" ") : undefined };
  }
  return {};
}

// Coerce any trait value to a string (contact custom fields/properties are string-valued).
export function stringifyValue(value: any): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

// The connector records which audiences/lists it manages on the contact itself (a bookkeeping field),
// so it only ever removes memberships it added. The set is bracket-wrapped so an empty set is still a
// non-empty string ("[]") — some backends silently ignore empty-string field writes.
export function encodeManagedIds(ids: string[]): string {
  return `[${ids.join(",")}]`;
}

export function decodeManagedIds(value: any): string[] {
  if (typeof value !== "string") {
    return [];
  }
  const inner = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return splitCsv(inner);
}

// The desired target (audience/list) name set for an event: the per-event override trait if present
// (even empty, meaning "clear"), otherwise the configured value. `undefined` means neither was specified
// — membership is then left untouched (no reconciliation).
export function desiredTargetNames(
  event: AnalyticsServerEvent,
  overrideTrait: string,
  configValue?: string
): string[] | undefined {
  const traits = getTraits(event);
  if (overrideTrait in traits) {
    return splitCsv(traits[overrideTrait]);
  }
  if (configValue && configValue.trim()) {
    return splitCsv(configValue);
  }
  return undefined;
}

// Store key for the optional userId→email cache.
export function userEmailCacheKey(prefix: string, userId: string): string {
  return `${prefix}:uid:${userId}`;
}

// Classify an API error: retry on rate limits (429) and server errors (5xx); treat other 4xx as
// permanent so the event isn't retried forever.
export function classifyError(prefix: string, e: any): Error {
  if (e instanceof JsonFetchError && e.responseStatus < 500 && e.responseStatus !== 429) {
    return new Error(`${prefix}: ${e.message}`);
  }
  return new RetryError(`${prefix}: ${e?.message || e}`);
}
