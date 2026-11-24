// Helpers for fetch calls that a sandboxed UDF worker proxies through the main process (see workspace-worker.ts).
// No worker or postMessage globals in here, so they can be unit tested.

import { DropRetryErrorName, RetryError, RetryErrorName } from "@jitsu/functions-lib";

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
  // The Response constructor throws a RangeError for a status outside 200-599 (101 aside), but a real server can
  // send one (999 is a known anti-bot status) and the previous plain-object response carried it. Build with a status
  // the constructor accepts; `status` is then defined as an own property below, so the UDF sees the real one.
  const constructible = s.status === 101 || (s.status >= 200 && s.status <= 599);
  const res = new Response(nullBodyStatuses.has(s.status) ? null : bytes, {
    status: constructible ? s.status : 200,
    statusText: s.statusText,
    headers: s.headers,
  });
  let decoded: string | undefined;
  const text = () => (decoded ??= new TextDecoder().decode(bytes));
  const reusable = {
    status: s.status,
    statusText: s.statusText,
    ok: s.ok,
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
  // The previous worker response was a plain object, so its data fields were own enumerable properties: a UDF could
  // JSON.stringify(res), spread it or list its keys. The data stays enumerable here; the methods stay hidden.
  for (const [key, value] of Object.entries(reusable)) {
    Object.defineProperty(res, key, { value, configurable: true, enumerable: typeof value !== "function" });
  }
  // `.body` is the decoded text, as in the previous worker response and in the in-process buffered response, so a UDF
  // can JSON.parse(res.body) and return it inside an event (a stream cannot be cloned out of the worker)
  Object.defineProperty(res, "body", { get: text, configurable: true, enumerable: true });
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

/**
 * Whether a fetch call is logged, decided when the call starts. The debug window (`debugTill`) can pass while a UDF is
 * running, so the rule is applied to each call and not once when the UDF's context is built; as in the in-process fetch.
 */
export function shouldLogFetchCall(
  fetchLogLevel: string | undefined,
  debugTill: Date | undefined,
  perCall?: { log?: boolean },
  now = Date.now()
): boolean {
  return isFetchCallLogged(isFetchLogEnabled(fetchLogLevel, debugTill, now), perCall);
}

/** The timeout the caller asked for (x-request-timeout-ms), else the server default. */
export function proxiedFetchTimeoutMs(requested: unknown, defaultMs: number): number {
  return typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : defaultMs;
}

// What the in-process fetch (makeFetch in core-functions-lib) records for a call, so that a paid function run in a worker
// shows the same details in the console's HTTP log: the request headers with the sensitive ones hidden, and the
// response body, cut to a length the log can hold.

/** The [name, value] pairs of request headers in any form fetch accepts: an object, a Headers or Map, or an array, Set or other iterable of pairs. */
function headerPairs(headers: any): Array<[string, any]> {
  // An array, a Set, a Map, a Headers or a generator all iterate as [name, value] pairs. forEach does not: a Set calls back
  // with (value, value), which made the whole pair the name.
  if (headers && typeof headers !== "string" && typeof headers[Symbol.iterator] === "function") {
    // each pair is itself an iterable of at least two items: an array, or for fetch also a Set or a generator
    return [...headers].flatMap((p): Array<[string, any]> => {
      const pair = p && typeof p === "object" && typeof p[Symbol.iterator] === "function" ? [...p] : undefined;
      return pair && pair.length >= 2 ? [[String(pair[0]), pair[1]]] : [];
    });
  }
  return Object.entries(headers ?? {});
}

/**
 * The init of a fetch call, as a worker message can carry it. A UDF may pass `headers: new Headers(...)` or an iterable of pairs; the call goes to
 * the main process with postMessage, which structured-clones the init. Node refuses to clone a Headers, and Deno clones it
 * to an empty object, so the request would leave without its headers (an Authorization header, typically). The headers
 * go as [name, value] pairs, which fetch accepts; object and pair headers already clone and are left as they are, and the
 * init the UDF passed is not changed.
 */
export function transferableFetchInit(init: any): any {
  const prepared = transferableHeaders(init);
  const body = prepared?.body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    // postMessage turns it into a plain object, and fetch would send "[object Object]": it goes as the text fetch makes of it,
    // with the content type fetch gives it unless the caller set one
    const headers = wirePairs(prepared.headers);
    if (!headers.some(([name]) => name.toLowerCase() === "content-type")) {
      headers.push(["content-type", "application/x-www-form-urlencoded;charset=UTF-8"]);
    }
    return { ...prepared, body: body.toString(), headers };
  }
  return prepared;
}

/**
 * The [name, value] pairs of the headers as they go on the wire. Unlike headerPairs, which is tolerant because it only feeds
 * the log, this refuses what fetch refuses: a pair that does not have exactly two items. A header must not vanish (or be
 * cut) on its way to the main process.
 */
function wirePairs(headers: any): Array<[string, string]> {
  if (headers && typeof headers === "object" && typeof headers[Symbol.iterator] === "function") {
    return [...headers].map(p => {
      const pair = p && typeof p === "object" && typeof p[Symbol.iterator] === "function" ? [...p] : undefined;
      if (!pair || pair.length !== 2) {
        throw new TypeError(
          `Headers: expected name/value pair to be length 2, found ${pair ? pair.length : "a non-pair"}.`
        );
      }
      return [String(pair[0]), String(pair[1])];
    });
  }
  return Object.entries(headers ?? {}).map(([name, value]) => [name, String(value)]);
}

function transferableHeaders(init: any): any {
  const h = init && typeof init === "object" ? init.headers : undefined;
  const isIterable = (x: any) => x && typeof x === "object" && typeof x[Symbol.iterator] === "function";
  if (isIterable(h)) {
    // an array, a Map or a Set clones as it is and can be read again, unless a pair in it is a one-shot iterator; anything
    // else (a Headers, a generator) is read here, once, and the same array serves the log entry and the request
    const cloneable = Array.isArray(h) || h instanceof Map || h instanceof Set;
    if (!cloneable || (!(h instanceof Map) && [...h].some(p => isIterable(p) && !Array.isArray(p)))) {
      return { ...init, headers: wirePairs(h) };
    }
  }
  return init;
}

const SENSITIVE_HEADER = /authorization|token|cookie|api[-_]?key|secret|password/i;

/**
 * Same rule as makeFetch: a header whose name contains "authorization", "token", "cookie", "api-key", "secret" or "password" is hidden. The headers may be an object,
 * a Headers or Map, or an array of [name, value] pairs: Object.entries of an array would give the keys "0", "1" and miss
 * the name.
 */
export function hideSensitiveHeaders(headers: any): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of headerPairs(headers)) {
    result[k] = SENSITIVE_HEADER.test(k) ? "*****" : v;
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

/**
 * The timeout for a fetch a worker asks for. A worker is sandboxed tenant code and can post any message, so the number in
 * its request is only a request: it cannot raise the timeout above the largest one the main process gave to an execution
 * running in that worker (the x-request-timeout-ms of the call), or above the server default when none is running.
 */
export function boundedFetchTimeoutMs(requested: unknown, granted: Iterable<number>, defaultMs: number): number {
  const wanted = proxiedFetchTimeoutMs(requested, defaultMs);
  const grants = [...granted].filter(g => Number.isFinite(g) && g > 0);
  return Math.min(wanted, grants.length > 0 ? Math.max(...grants) : defaultMs);
}

/**
 * What a UDF can see on a failed fetch: `err.code` (EBLOCKED from the host check), `err.cause.code` (undici's) and, for the
 * standard types below, `err.name`.
 */
export type ProxyErrorCodes = { code?: string; causeCode?: string; name?: string };

// undici rejects a failed fetch with a TypeError and an aborted one with an AbortError or TimeoutError. A UDF that checks
// `err instanceof TypeError` or `err.name` must get the same answer in a worker. Only these names are taken from a worker
// message; anything else becomes a plain Error.
// A RetryError (a failed store call: storeErr wraps the transient failures of the MongoDB store in one) goes back as a real
// RetryError, dropping or not, so the event is retried as in process.
const PROXY_ERROR_NAMES = ["TypeError", "RangeError", "AbortError", "TimeoutError", RetryErrorName, DropRetryErrorName];

export function errorCodesOf(err: any): ProxyErrorCodes {
  const code = typeof err?.code === "string" ? err.code : undefined;
  const causeCode = typeof err?.cause?.code === "string" ? err.cause.code : undefined;
  const name = typeof err?.name === "string" && PROXY_ERROR_NAMES.includes(err.name) ? err.name : undefined;
  return { ...(code ? { code } : {}), ...(causeCode ? { causeCode } : {}), ...(name ? { name } : {}) };
}

/** The error a worker rejects with for a failed proxy call: the message, the type and the same code fields the in-process fetch has. */
export function rebuildProxyError(message: string, codes: ProxyErrorCodes = {}): Error {
  // A timeout or an abort is a DOMException in process, with the legacy numeric code (TimeoutError 23, AbortError 20) that
  // a UDF may test; one built with the name has the same code.
  if (codes.name === RetryErrorName || codes.name === DropRetryErrorName) {
    return new RetryError(message, { drop: codes.name === DropRetryErrorName });
  }
  const err: any =
    (codes.name === "TimeoutError" || codes.name === "AbortError") && typeof DOMException !== "undefined"
      ? new DOMException(message, codes.name)
      : codes.name === "TypeError"
      ? new TypeError(message)
      : new Error(message);
  // a DOMException has its name and its numeric code from the constructor, and no setter for either
  const isDomException = typeof DOMException !== "undefined" && err instanceof DOMException;
  if (!isDomException && codes.name && PROXY_ERROR_NAMES.includes(codes.name)) err.name = codes.name;
  if (!isDomException && codes.code) err.code = codes.code;
  if (codes.causeCode) err.cause = { code: codes.causeCode };
  return err;
}
