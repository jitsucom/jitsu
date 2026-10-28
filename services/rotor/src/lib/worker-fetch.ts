// Helpers for fetch calls that a sandboxed UDF worker proxies through the main process (see workspace-worker.ts).
// No worker or postMessage globals in here, so they can be unit tested.

export type SerializedResponse = {
  status: number;
  statusText: string;
  ok: boolean;
  url: string;
  type: string;
  redirected: boolean;
  headers: [string, string][];
  body: Uint8Array;
};

export async function serializeResponse(res: Response): Promise<SerializedResponse> {
  const headers: [string, string][] = [];
  res.headers.forEach((v, k) => headers.push([k, v]));
  return {
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    url: res.url,
    type: res.type,
    redirected: res.redirected,
    headers,
    body: new Uint8Array(await res.arrayBuffer()),
  };
}

const nullBodyStatuses = new Set([101, 204, 205, 304]);

/**
 * A real Response (headers.get(), status, instanceof), whose body can be read more than once, as with the in-process
 * fetch: a UDF that reads text() for a diagnostic and then json() must keep working.
 */
export function deserializeResponse(s: SerializedResponse): Response {
  const bytes = nullBodyStatuses.has(s.status) ? new Uint8Array(0) : s.body;
  const res = new Response(nullBodyStatuses.has(s.status) ? null : bytes, {
    status: s.status,
    statusText: s.statusText,
    headers: s.headers,
  });
  const text = () => new TextDecoder().decode(bytes);
  const reusable = {
    // not settable through the constructor
    url: s.url,
    type: s.type,
    redirected: s.redirected,
    text: async () => text(),
    json: async () => JSON.parse(text()),
    arrayBuffer: async () => bytes.slice().buffer,
    bytes: async () => bytes.slice(),
    blob: async () => new Blob([bytes], { type: res.headers.get("content-type") ?? "" }),
    clone: () => deserializeResponse(s),
  };
  for (const [key, value] of Object.entries(reusable)) {
    Object.defineProperty(res, key, { value, configurable: true });
  }
  return res;
}

/** Same rule as the in-process runtime: with fetchLogLevel "debug" (nofetchlogs) log only while debugging is active. */
export function isFetchLogEnabled(fetchLogLevel: string | undefined, debugTill: Date | undefined, now = Date.now()) {
  return fetchLogLevel !== "debug" || !!(debugTill && debugTill.getTime() > now);
}

/**
 * Whether one fetch call is logged: the connection-level rule, and the caller's own `log: false` (third argument of
 * ctx.fetch) which suppresses it for payloads that must not be stored. `log: true` cannot override the connection rule.
 */
export function isFetchCallLogged(connectionEnabled: boolean, perCall?: { log?: boolean }): boolean {
  return connectionEnabled && (typeof perCall?.log === "boolean" ? perCall.log : true);
}

/** The timeout the caller asked for (x-request-timeout-ms), else the server default. */
export function proxiedFetchTimeoutMs(requested: unknown, defaultMs: number): number {
  return typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : defaultMs;
}
