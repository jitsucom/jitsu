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
  /** bytes; a string is accepted for producers that still send the decoded text */
  body: Uint8Array | string;
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
 * The free class and the Functions Debugger used to get a plain headers object (`res.headers["x-next-page"]`), the
 * in-process fetch gets a real Headers (`res.headers.get("x-next-page")`). The rebuilt Response supports both, so a UDF
 * written against either keeps working.
 *
 * It is a plain object with a property per header, as before (read by name, Object.keys, spread, JSON), and the Headers
 * methods (`get`, `has`, `forEach`, `keys`, `values`, `entries`, iteration) as non-enumerable properties. It has to stay
 * plain data: a worker answers with postMessage, which structured-clones the result, so whatever a UDF puts in an event
 * or logs (`event.h = res.headers`) must clone. Structured clone leaves non-enumerable properties out; a Headers or a
 * Proxy of one makes it throw, and the worker then drops the whole result. A header named like one of these methods
 * (`get`, `keys`...) is reached through the method.
 */
function withPlainObjectHeaderAccess(headers: Headers): Headers {
  const plain: Record<string | symbol, any> = {};
  headers.forEach((value, name) => {
    plain[name] = value;
  });
  const methods: Record<string | symbol, any> = {
    get: (name: string) => headers.get(name),
    has: (name: string) => headers.has(name),
    forEach: (callback: (value: string, name: string, parent: Headers) => void, thisArg?: any) =>
      headers.forEach(callback, thisArg),
    keys: () => headers.keys(),
    values: () => headers.values(),
    entries: () => headers.entries(),
    getSetCookie: () => headers.getSetCookie?.() ?? [],
    [Symbol.iterator]: () => headers.entries(),
  };
  for (const key of Reflect.ownKeys(methods)) {
    Object.defineProperty(plain, key, { value: methods[key], enumerable: false, configurable: true, writable: true });
  }
  return plain as unknown as Headers;
}

/**
 * A real Response (headers.get(), status, instanceof), whose body can be read more than once, as with the in-process
 * fetch: a UDF that reads text() for a diagnostic and then json() must keep working.
 */
export function deserializeResponse(s: SerializedResponse): Response {
  const bytes = nullBodyStatuses.has(s.status)
    ? new Uint8Array(0)
    : typeof s.body === "string"
    ? new TextEncoder().encode(s.body)
    : s.body;
  const res = new Response(nullBodyStatuses.has(s.status) ? null : bytes, {
    status: s.status,
    statusText: s.statusText,
    headers: s.headers,
  });
  let decoded: string | undefined;
  const text = () => (decoded ??= new TextDecoder().decode(bytes));
  const reusable = {
    headers: withPlainObjectHeaderAccess(res.headers),
    // as in the previous worker response and in the in-process buffered response
    bodyUsed: true,
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
  // `.body` is the decoded text, as in the previous worker response and in the in-process buffered response, so a UDF
  // can JSON.parse(res.body) and return it inside an event (a stream cannot be cloned out of the worker)
  Object.defineProperty(res, "body", { get: text, configurable: true });
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

// What the in-process fetch (makeFetch in core-functions-lib) records for a call, so that a paid function run in a worker
// shows the same details in the console's HTTP log: the request headers with the sensitive ones hidden, and the
// response body, cut to a length the log can hold.

/** Same rule as makeFetch: a header whose name contains "authorization" or "token" is hidden. */
export function hideSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    result[k] = k.toLowerCase().includes("authorization") || k.toLowerCase().includes("token") ? "*****" : v;
  }
  return result;
}

/** The response text as it is logged: at most `maxLen` characters, with the full length named when it was cut. */
export function trimLoggedResponse(text: string, maxLen: number = 1000): string {
  return text.length > maxLen ? `${text.substring(0, maxLen)} ... [truncated, length: ${text.length}]` : text;
}

/** A JSON response is logged as an object, anything else as the text. */
export function parseLoggedResponse(text: string): any {
  try {
    return JSON.parse(text);
  } catch (err) {
    return text;
  }
}

export function responseBodyText(s: SerializedResponse): string {
  return typeof s.body === "string" ? s.body : new TextDecoder().decode(s.body);
}
