import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import { isBlockedAddress } from "@jitsu/core-functions-lib";

/**
 * Outbound HTTP(S) request to a user-supplied URL. Every address the hostname resolves to must be public, the check
 * happens at connect time on the address actually used (so a rebinding DNS answer cannot slip in between a check and the
 * connection), IP-literal hosts are checked directly because they never reach `lookup`, redirects are never followed and
 * the response body is read only up to a small cap and discarded.
 *
 * Errors carry a stable code and `maybeDelivered`: false when the request provably never left (blocked address, DNS,
 * connection or TLS failure before the connection was established), true once a connection existed. Messages are the code
 * only, so a URL, header or body never ends up in a log. `detail` is the operating-system error code behind a transport
 * failure (for example `ECONNRESET`), kept only when it looks like one, so a run that fails with a bare `connection_error`
 * can still be diagnosed; it never carries free text.
 */

export type GuardedRequestErrorCode =
  | "invalid_url"
  | "blocked_address"
  | "dns_error"
  | "tls_error"
  | "connection_error"
  | "timeout"
  | "aborted";

export class GuardedRequestError extends Error {
  constructor(readonly code: GuardedRequestErrorCode, readonly maybeDelivered: boolean, readonly detail?: string) {
    super(code);
    this.name = "GuardedRequestError";
  }
}

const systemErrorCodePattern = /^[A-Z][A-Z0-9_]{1,31}$/;

/** The error's `code` if it is an UPPER_SNAKE token such as `ECONNRESET`; anything else is dropped, never sanitised. */
function systemErrorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && systemErrorCodePattern.test(code) ? code : undefined;
}

export interface GuardedRequest {
  url: string;
  method?: "POST";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseBytes?: number;
}

export interface GuardedResponse {
  status: number;
  /** The `Retry-After` header as received, for the caller to interpret. */
  retryAfter?: string;
  /** More than `maxResponseBytes` arrived; the rest was discarded. */
  truncated: boolean;
}

type Resolved = { address: string; family: number };

export interface GuardedRequestDeps {
  /** Hostname resolution; replaceable in tests. */
  resolve?: (hostname: string) => Promise<Resolved[]>;
  /** Address classification; replaceable in tests so a local server can be reached. Production uses the default. */
  isBlocked?: (address: string) => boolean;
  /** Extra trusted certificate authorities (PEM); for tests only. */
  ca?: string;
}

const tlsCodes = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "HOSTNAME_MISMATCH",
]);

function isTlsError(error: NodeJS.ErrnoException): boolean {
  const code = error.code ?? "";
  return code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || tlsCodes.has(code);
}

export function createGuardedRequest(deps: GuardedRequestDeps = {}) {
  const resolve =
    deps.resolve ??
    (async (hostname: string) => (await dns.promises.lookup(hostname, { all: true, verbatim: true })) as Resolved[]);
  const isBlocked = deps.isBlocked ?? isBlockedAddress;

  // Node calls lookup with { all: true } when it picks between address families, so both shapes are supported.
  const lookup = (hostname: string, options: dns.LookupOptions, callback: (...args: any[]) => void) => {
    resolve(hostname).then(
      addresses => {
        let list = addresses;
        if (options?.family === 4 || options?.family === 6) list = list.filter(a => a.family === options.family);
        if (!list.length) return callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
        // One non-public answer blocks the host: a name that resolves to both is not a safe destination.
        if (addresses.some(a => isBlocked(a.address)))
          return callback(Object.assign(new Error("blocked"), { code: "EBLOCKED" }));
        if (options?.all) callback(null, list);
        else callback(null, list[0].address, list[0].family);
      },
      error => callback(error)
    );
  };

  return function guardedRequest(request: GuardedRequest): Promise<GuardedResponse> {
    const connectTimeoutMs = request.connectTimeoutMs ?? 10_000;
    const totalTimeoutMs = request.totalTimeoutMs ?? 30_000;
    const maxResponseBytes = request.maxResponseBytes ?? 64 * 1024;

    return new Promise<GuardedResponse>((resolvePromise, rejectPromise) => {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return rejectPromise(new GuardedRequestError("invalid_url", false));
      }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        return rejectPromise(new GuardedRequestError("invalid_url", false));
      }
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (net.isIP(host) && isBlocked(host)) {
        return rejectPromise(new GuardedRequestError("blocked_address", false));
      }
      if (request.signal?.aborted) {
        return rejectPromise(new GuardedRequestError("aborted", false));
      }

      const secure = url.protocol === "https:";
      const body = typeof request.body === "string" ? Buffer.from(request.body) : request.body ?? Buffer.alloc(0);
      let connected = false;
      let settled = false;
      let status: number | undefined;
      let retryAfter: string | undefined;
      let truncated = false;
      let received = 0;
      let connectTimer: NodeJS.Timeout | undefined;
      let totalTimer: NodeJS.Timeout | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = () => {
        clearTimeout(connectTimer);
        clearTimeout(totalTimer);
        if (onAbort) request.signal?.removeEventListener("abort", onAbort);
      };
      const succeed = () => {
        if (settled || status === undefined) return;
        settled = true;
        cleanup();
        resolvePromise({ status, retryAfter, truncated });
      };
      const fail = (code: GuardedRequestErrorCode, detail?: string) => {
        if (settled) return;
        if (status !== undefined) return succeed(); // a definite status beats a late transport error
        settled = true;
        cleanup();
        rejectPromise(new GuardedRequestError(code, connected, detail));
      };

      const headers: Record<string, string | number> = { ...request.headers, "content-length": body.byteLength };
      const options: https.RequestOptions = {
        hostname: host,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: request.method ?? "POST",
        headers,
        lookup: lookup as any,
        agent: secure ? new https.Agent({ keepAlive: false, ca: deps.ca }) : new http.Agent({ keepAlive: false }),
      };
      const req = (secure ? https : http).request(options, res => {
        status = res.statusCode ?? 0;
        const header = res.headers["retry-after"];
        retryAfter = Array.isArray(header) ? header[0] : header;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxResponseBytes) {
            truncated = true;
            res.destroy();
          }
        });
        res.on("end", succeed);
        res.on("close", succeed);
        res.on("error", succeed);
      });

      // A 101 Switching Protocols answer is delivered as an `upgrade` event, never to the response callback above, so
      // without this handler the promise would wait for the total timeout. We never switch protocols: report the status
      // (the caller classifies it as a rejection) and drop the connection.
      req.on("upgrade", (res, socket) => {
        status = res.statusCode ?? 101;
        socket.destroy();
        succeed();
      });

      req.on("socket", socket => {
        socket.once(secure ? "secureConnect" : "connect", () => {
          connected = true;
          clearTimeout(connectTimer);
        });
      });
      req.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EBLOCKED") return fail("blocked_address");
        if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN" || error.code === "EAI_FAIL")
          return fail("dns_error", systemErrorCode(error));
        if (isTlsError(error)) return fail("tls_error", systemErrorCode(error));
        return fail("connection_error", systemErrorCode(error));
      });

      connectTimer = setTimeout(() => {
        fail("timeout");
        req.destroy();
      }, connectTimeoutMs);
      totalTimer = setTimeout(() => {
        fail("timeout");
        req.destroy();
      }, totalTimeoutMs);
      if (request.signal) {
        onAbort = () => {
          fail("aborted");
          req.destroy();
        };
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
      req.end(body);
    });
  };
}

/** The request function production code uses: strict address checks, system DNS. */
export const guardedRequest = createGuardedRequest();
