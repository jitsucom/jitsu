import * as dns from "node:dns";
import * as net from "node:net";
import { Agent, buildConnector } from "undici";
import { isBlockedAddress } from "./public-address";

type Resolved = { address: string; family: number };

/**
 * Host as it is compared against FETCH_LOCAL_WHITELIST: lowercase, without the brackets of an IPv6 literal (the URL
 * parser keeps them in `hostname`, the socket layer does not), so `[::1]` and `::1` are the same entry.
 */
export function normalizeHostname(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

export interface GuardedAgentOptions {
  /** Hostnames (lowercase) that may resolve to local addresses, e.g. FETCH_LOCAL_WHITELIST. */
  allowedHosts?: string[];
  /** Hostname resolution; replaceable in tests. */
  resolve?: (hostname: string) => Promise<Resolved[]>;
  /** Address classification; replaceable in tests. */
  isBlocked?: (address: string) => boolean;
}

/**
 * undici Agent that refuses to connect to non-public addresses. The check runs when a connection is opened, on the
 * address that is actually used, so it covers what a resolve-then-fetch pre-check cannot: a DNS answer that changes
 * between the check and the connection (rebinding), and every hop of a redirect chain. IP-literal hosts never reach
 * `lookup`, so they are checked in the connector.
 */
export function createGuardedAgent(options: GuardedAgentOptions = {}): Agent {
  const allowed = new Set((options.allowedHosts ?? []).map(normalizeHostname));
  const resolve =
    options.resolve ??
    (async (hostname: string) => (await dns.promises.lookup(hostname, { all: true, verbatim: true })) as Resolved[]);
  const isBlocked = options.isBlocked ?? isBlockedAddress;
  const blocked = () => Object.assign(new Error("blocked address"), { code: "EBLOCKED" });

  const lookup = (hostname: string, lookupOptions: dns.LookupOptions, callback: (...args: any[]) => void) => {
    resolve(hostname).then(
      addresses => {
        let list = addresses;
        if (lookupOptions?.family === 4 || lookupOptions?.family === 6) {
          list = list.filter(a => a.family === lookupOptions.family);
        }
        if (!list.length) {
          return callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
        }
        // One non-public answer blocks the host: a name that resolves to both is not a safe destination
        if (!allowed.has(normalizeHostname(hostname)) && addresses.some(a => isBlocked(a.address))) {
          return callback(blocked());
        }
        if (lookupOptions?.all) {
          callback(null, list);
        } else {
          callback(null, list[0].address, list[0].family);
        }
      },
      error => callback(error)
    );
  };

  const connector = buildConnector({ lookup: lookup as any });
  return new Agent({
    connect: (connectOptions, callback) => {
      const host = normalizeHostname(connectOptions.hostname);
      if (net.isIP(host) && !allowed.has(host) && isBlocked(host)) {
        callback(blocked(), null);
        return;
      }
      return connector(connectOptions, callback);
    },
  });
}
