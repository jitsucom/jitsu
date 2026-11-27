import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { serialize } from "cookie";
import type { NextApiRequest } from "next";
import { getServerEnv } from "./serverEnv";

/**
 * Binds an OIDC login to the browser that started it.
 *
 * The signed `state` of the authorization request travels in the callback URL, so whoever holds it can hand that URL to
 * someone else and sign them in as themselves. `authorize` therefore also sets a random value in a cookie of this browser
 * and puts only its hash in the state; `callback` accepts the state only together with the cookie it was bound to.
 *
 * Every login attempt has its own cookie, named after an attempt id that is also in the signed state: two logins of one
 * browser (two tabs) do not overwrite each other, and a callback spends only its own cookie.
 */
export const OIDC_LOGIN_STATE_COOKIE = "oidc-login-state";
export const OIDC_LOGIN_STATE_MAX_AGE_SEC = 10 * 60; // as long as the state itself lives
/** Query parameter that marks a request already sent once to the configured host, so that a proxy cannot make it loop */
export const CANONICAL_HOST_MARKER = "_canonical";

// Over plain http (local development) only the OIDC routes need the cookie
const NARROW_PATH = "/api/auth/dynamic-oidc";
const ATTEMPT_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;
/**
 * How many binding cookies one browser keeps. Over https they travel with every request to the console, and every abandoned
 * attempt or provider error leaves one for ten minutes: without a bound they could add up to more than the header limit of a
 * proxy and make unrelated requests fail. When a login starts, the oldest ones beyond the bound are cleared.
 */
export const MAX_PENDING_LOGIN_BINDINGS = 5;
/**
 * How many surplus binding cookies one response clears, oldest first. Each deletion is a Set-Cookie header of about 110 bytes,
 * and the callback sends them next to the session cookie after the authorization code has been used: a big surplus must not
 * make that response bigger than a proxy accepts. A surplus is cleared in small steps, by this many with every response.
 */
export const MAX_CLEARS_PER_RESPONSE = 3;

const firstOf = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.split(",")[0].trim() || undefined;

/**
 * Whether the request came in over https, as far as the proxy in front of it says. Two headers carry it, and Next.js fills in
 * `x-forwarded-proto` from its own socket (so "http") when the proxy sent only `x-forwarded-protocol: https`: a request is
 * https if either of them says so, and the first value of each list is the one of the client. A value that is not exactly
 * http or https is ignored. Without a usable value, the URL of the request decides.
 */
export function requestScheme(req: NextApiRequest): "http" | "https" {
  const schemes = forwardedSchemes(req);
  if (schemes.includes("https")) {
    return "https";
  }
  if (schemes.includes("http")) {
    return "http";
  }
  return req.url?.startsWith("https") ? "https" : "http";
}

/**
 * What the proxy says about the scheme: the first value of each of the two headers, and only when it is exactly `http` or
 * `https` (in any case). Any other value (`HTTP/2`, `ws`, an empty string) is not a statement about the scheme and is no
 * signal at all, so it can neither start a redirect nor count as https.
 */
function forwardedSchemes(req: NextApiRequest): ("http" | "https")[] {
  const out: ("http" | "https")[] = [];
  for (const header of ["x-forwarded-proto", "x-forwarded-protocol"]) {
    const value = (firstOf(req.headers[header]) || "").toLowerCase();
    if (value === "http" || value === "https") {
      out.push(value);
    }
  }
  return out;
}

/** The public URL of the console as it is configured, which is where the identity provider sends the browser back to. */
function configuredPublicUrl(): string | undefined {
  const serverEnv = getServerEnv();
  return serverEnv.NEXTAUTH_URL || serverEnv.JITSU_PUBLIC_URL || undefined;
}

/**
 * The base URL the identity provider sends the browser back to: the one `authorize` builds the redirect URI from. The cookie
 * belongs to this host, and its Secure flag and its name follow this URL, not what the request looks like to the process:
 * a proxy that terminates TLS may forward only `X-Forwarded-Protocol`, or nothing.
 */
export function oidcBaseUrl(req: NextApiRequest): string {
  const configured = configuredPublicUrl();
  if (configured) {
    return configured;
  }
  return `${requestScheme(req)}://${req.headers.host}`;
}

const isHttps = (baseUrl: string) => /^https:\/\//i.test(baseUrl);

/**
 * Where a request must go before a binding cookie is set, or undefined when it can be served as it is. The cookie is host-only
 * and Secure over an https public URL, and the identity provider returns to the configured address, so a request is sent
 * there once when it
 *  - arrived on another host name than the configured one (the cookie would not be sent back), or
 *  - is not positively https while the public URL is https: a Secure cookie set over plain http is dropped by the browser,
 *    and the https callback would find none.
 * "Positively https" is a TLS connection of the server itself or a forwarded scheme that says https, and in both cases no
 * forwarded scheme says http: an explicit http outranks everything else. A missing, odd or contradicting scheme is doubt, and doubt is resolved by the redirect: one extra hop that
 * is bounded by the marker and costs no login budget (it is made before the rate limit), instead of a login that breaks.
 * The target is built from the configured origin and the path and query of the request, never from a host the request names.
 * Without a configured public URL the base is the request itself and there is nothing to move to.
 */
export function canonicalAuthorizeLocation(req: NextApiRequest): string | undefined {
  if (!configuredPublicUrl()) {
    return undefined;
  }
  let base: URL;
  try {
    base = new URL(oidcBaseUrl(req));
  } catch {
    return undefined;
  }
  const requestHost = (firstOf(req.headers["x-forwarded-host"]) || req.headers.host || "").toLowerCase();
  if (!requestHost) {
    return undefined;
  }
  const schemes = forwardedSchemes(req);
  const tls = (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
  // an explicit http outranks everything: a proxy may take the browser's request over plain http and still connect over TLS
  const positivelyHttps = !schemes.includes("http") && (tls || schemes.includes("https"));
  const doubtful = base.protocol === "https:" && !positivelyHttps;
  if (requestHost === base.host.toLowerCase() && !doubtful) {
    return undefined;
  }
  if (req.query?.[CANONICAL_HOST_MARKER]) {
    return undefined;
  }
  // only the path and the query are taken from the request: the parser may read `//host` or `/\host` as another host
  const incoming = new URL(req.url || "/", "http://placeholder.invalid");
  incoming.searchParams.set(CANONICAL_HOST_MARKER, "1");
  return `${base.origin}${incoming.pathname}${incoming.search}`;
}

const ATTEMPT_TIME_DIGITS = 9;

/**
 * A fresh secret for one login attempt: the id of the attempt, the value for the cookie and the hash for the state. The id
 * starts with the time of the attempt (nine base-36 digits, sortable as text), so that the oldest cookies of a browser can be
 * told from the newest without a lookup. The time is not a secret and adds nothing to what the cookie value protects.
 */
export function newLoginBinding(now: number = Date.now()): { attempt: string; value: string; hash: string } {
  // 128 bits are plenty for a secret that is compared by its hash, and a cookie that travels with every request stays small
  const value = randomBytes(16).toString("base64url");
  const attempt = now.toString(36).padStart(ATTEMPT_TIME_DIGITS, "0") + randomBytes(8).toString("base64url");
  return { attempt, value, hash: hashLoginBinding(value) };
}

export function hashLoginBinding(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** An attempt id that came out of a signed state is ours, but it is still checked before it becomes part of a cookie name. */
export function isValidLoginAttempt(attempt: unknown): attempt is string {
  return typeof attempt === "string" && ATTEMPT_PATTERN.test(attempt);
}

/** Whether the cookie of this request is the one the state was bound to. A missing or empty cookie never matches. */
export function loginBindingMatches(cookieValue: unknown, stateHash: unknown): boolean {
  if (typeof cookieValue !== "string" || cookieValue === "" || typeof stateHash !== "string" || stateHash === "") {
    return false;
  }
  const actual = Buffer.from(hashLoginBinding(cookieValue));
  const expected = Buffer.from(stateHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Over https the name has the `__Host-` prefix: the browser then accepts the cookie only with Secure, Path=/ and no Domain,
 * so a cookie of the same name set by a less trusted sibling host for the whole parent domain cannot be supplied in its place.
 */
export function loginBindingCookieName(req: NextApiRequest, attempt: string): string {
  return `${isHttps(oidcBaseUrl(req)) ? "__Host-" : ""}${OIDC_LOGIN_STATE_COOKIE}-${attempt}`;
}

// Lax, not Strict: the identity provider sends the browser back with a cross-site navigation, and Strict cookies are
// not sent on it. Lax cookies are sent on a top-level GET navigation, which is what the callback is.
const cookieOptions = (req: NextApiRequest) => {
  const https = isHttps(oidcBaseUrl(req));
  return { httpOnly: true, secure: https, sameSite: "lax" as const, path: https ? "/" : NARROW_PATH };
};

export function loginBindingCookie(req: NextApiRequest, attempt: string, value: string): string {
  return serialize(loginBindingCookieName(req, attempt), value, {
    ...cookieOptions(req),
    maxAge: OIDC_LOGIN_STATE_MAX_AGE_SEC,
  });
}

export function clearLoginBindingCookie(req: NextApiRequest, attempt: string): string {
  return serialize(loginBindingCookieName(req, attempt), "", { ...cookieOptions(req), maxAge: 0 });
}

/**
 * The Set-Cookie values that clear the oldest binding cookies of this browser, so that no more than MAX_PENDING_LOGIN_BINDINGS
 * remain once the response has been sent. Only cookies named as this server names them are looked at.
 *  - `room` is how many new cookies the response is about to add: 1 when a login starts (the default), 0 when one finishes.
 *  - `ignore` is an attempt that is not counted and not cleared here, because the caller clears it itself.
 * The server keeps no state about a browser, so this only sees the cookies of the request it answers: requests that are in
 * flight at the same moment can leave more behind, and the next requests that reach this function clear the surplus, at most
 * `limit` (MAX_CLEARS_PER_RESPONSE) cookies per response and the oldest first.
 */
export function clearStaleLoginBindingCookies(
  req: NextApiRequest,
  { room = 1, ignore, limit = MAX_CLEARS_PER_RESPONSE }: { room?: number; ignore?: string; limit?: number } = {}
): string[] {
  const attempts: string[] = [];
  for (const name of Object.keys(req.cookies || {})) {
    const m = /^(?:__Host-)?oidc-login-state-(.+)$/.exec(name);
    if (m && m[1] !== ignore && isValidLoginAttempt(m[1]) && loginBindingCookieName(req, m[1]) === name) {
      attempts.push(m[1]);
    }
  }
  // newest first: the id starts with the time, in digits of fixed length
  attempts.sort().reverse();
  const surplus = attempts.slice(Math.max(0, MAX_PENDING_LOGIN_BINDINGS - room));
  // the oldest first, and no more than the limit
  return surplus
    .reverse()
    .slice(0, Math.max(0, limit))
    .map(attempt => clearLoginBindingCookie(req, attempt));
}
