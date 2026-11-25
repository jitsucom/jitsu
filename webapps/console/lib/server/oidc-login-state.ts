import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { serialize } from "cookie";
import type { NextApiRequest } from "next";
import { isSecure } from "./origin";

/**
 * Binds an OIDC login to the browser that started it.
 *
 * The signed `state` of the authorization request travels in the callback URL, so whoever holds it can hand that URL to
 * someone else and sign them in as themselves. `authorize` therefore also sets a random value in a cookie of this browser
 * and puts only its hash in the state; `callback` accepts the state only together with the cookie it was bound to.
 */
export const OIDC_LOGIN_STATE_COOKIE = "oidc-login-state";
export const OIDC_LOGIN_STATE_MAX_AGE_SEC = 10 * 60; // as long as the state itself lives

// Only the OIDC routes need it
const COOKIE_PATH = "/api/auth/dynamic-oidc";

/** A fresh secret for one login: the value for the cookie and the hash for the state. */
export function newLoginBinding(): { value: string; hash: string } {
  const value = randomBytes(32).toString("base64url");
  return { value, hash: hashLoginBinding(value) };
}

export function hashLoginBinding(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
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

// Lax, not Strict: the identity provider sends the browser back with a cross-site navigation, and Strict cookies are
// not sent on it. Lax cookies are sent on a top-level GET navigation, which is what the callback is.
const cookieOptions = (req: NextApiRequest) => ({
  httpOnly: true,
  secure: isSecure(req),
  sameSite: "lax" as const,
  path: COOKIE_PATH,
});

export function loginBindingCookie(req: NextApiRequest, value: string): string {
  return serialize(OIDC_LOGIN_STATE_COOKIE, value, { ...cookieOptions(req), maxAge: OIDC_LOGIN_STATE_MAX_AGE_SEC });
}

export function clearLoginBindingCookie(req: NextApiRequest): string {
  return serialize(OIDC_LOGIN_STATE_COOKIE, "", { ...cookieOptions(req), maxAge: 0 });
}
