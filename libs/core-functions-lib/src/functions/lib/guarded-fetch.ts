import { fetch as undiciFetch } from "undici";
import { createGuardedAgent, GuardedAgentOptions, normalizeHostname } from "./guarded-agent";

type FetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

/**
 * FETCH_LOCAL_WHITELIST: comma-separated hostnames that may stay local, normalised the same way the guarded agent
 * compares them (lowercase, no IPv6 brackets).
 */
export function parseLocalWhitelist(value: string | undefined): string[] {
  return value ? value.split(",").map(normalizeHostname) : [];
}

/**
 * FETCH_FORBID_LOCAL: the same spellings Bulker accepts for its guard (trimmed, any case): 1, true, yes, on. One value
 * set for every service has to turn the guard on everywhere.
 */
export function isForbidLocalEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

/**
 * fetch for URLs that a user chose: it refuses to connect to a non-public address, on the address actually used and on
 * every hop of a redirect chain (see createGuardedAgent). Unlike makeFetch it has no switch: callers that always want
 * the guard use this.
 */
export function createGuardedFetch(options: GuardedAgentOptions = {}) {
  const dispatcher = createGuardedAgent(options);
  return (url: string, init: FetchInit = {}) => undiciFetch(url, { ...init, dispatcher });
}

/** True when a fetch failed because the guarded agent refused a non-public address. */
export function isBlockedAddressError(error: any): boolean {
  return (error?.cause?.code ?? error?.code) === "EBLOCKED";
}
