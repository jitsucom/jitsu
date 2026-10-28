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

/** A real Response, so UDFs keep headers.get(), arrayBuffer(), clone(), etc. as with the in-process fetch. */
export function deserializeResponse(s: SerializedResponse): Response {
  const res = new Response(nullBodyStatuses.has(s.status) ? null : s.body, {
    status: s.status,
    statusText: s.statusText,
    headers: s.headers,
  });
  // not settable through the constructor
  for (const [key, value] of Object.entries({ url: s.url, type: s.type, redirected: s.redirected })) {
    Object.defineProperty(res, key, { value, configurable: true });
  }
  return res;
}

/** Same rule as the in-process runtime: with fetchLogLevel "debug" (nofetchlogs) log only while debugging is active. */
export function isFetchLogEnabled(fetchLogLevel: string | undefined, debugTill: Date | undefined, now = Date.now()) {
  return fetchLogLevel !== "debug" || !!(debugTill && debugTill.getTime() > now);
}

/** The timeout the caller asked for (x-request-timeout-ms), else the server default. */
export function proxiedFetchTimeoutMs(requested: unknown, defaultMs: number): number {
  return typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : defaultMs;
}
