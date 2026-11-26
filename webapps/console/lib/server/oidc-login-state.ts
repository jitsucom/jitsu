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

const firstOf = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.split(",")[0].trim() || undefined;

/**
 * The base URL the identity provider sends the browser back to: the one `authorize` builds the redirect URI from. The cookie
 * belongs to this host, and its Secure flag and its name follow this URL, not what the request looks like to the process:
 * a proxy that terminates TLS may forward only `X-Forwarded-Protocol`, or nothing.
 */
export function oidcBaseUrl(req: NextApiRequest): string {
  const serverEnv = getServerEnv();
  const configured = serverEnv.NEXTAUTH_URL || serverEnv.JITSU_PUBLIC_URL;
  if (configured) {
    return configured;
  }
  const protocol =
    firstOf(req.headers["x-forwarded-proto"]) ||
    firstOf(req.headers["x-forwarded-protocol"]) ||
    (req.url?.startsWith("https") ? "https" : "http");
  return `${protocol}://${req.headers.host}`;
}

const isHttps = (baseUrl: string) => /^https:\/\//i.test(baseUrl);

/**
 * Where a request that arrived on another host than the configured one must go before a binding cookie is set, or undefined
 * when it is on the right host (or has been sent there once already). A host-only cookie set on an alias is not sent to the
 * configured host that the callback returns to, so the login would end in `invalid_state`. The target is built from the
 * configured origin and the path and query of the request, never from a host the request names.
 */
export function canonicalAuthorizeLocation(req: NextApiRequest): string | undefined {
  let base: URL;
  try {
    base = new URL(oidcBaseUrl(req));
  } catch {
    return undefined;
  }
  const requestHost = (firstOf(req.headers["x-forwarded-host"]) || req.headers.host || "").toLowerCase();
  if (!requestHost || requestHost === base.host.toLowerCase()) {
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

/** A fresh secret for one login attempt: the id of the attempt, the value for the cookie and the hash for the state. */
export function newLoginBinding(): { attempt: string; value: string; hash: string } {
  const value = randomBytes(32).toString("base64url");
  return { attempt: randomBytes(12).toString("base64url"), value, hash: hashLoginBinding(value) };
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
