/** Sessions minted by an admin "become" carry the `impersonatedBy` claim and last one hour from sign-in. */
export const impersonationSessionLifetimeMs = 60 * 60 * 1000;
// Firebase refuses session cookies shorter than five minutes
const minSessionCookieMs = 5 * 60 * 1000;

type ImpersonationClaims = { impersonatedBy?: unknown; auth_time?: unknown };

export type ImpersonationState =
  | { impersonated: false }
  | { impersonated: true; expired: true }
  | { impersonated: true; expired: false; remainingMs: number };

/**
 * auth_time is the moment of the custom-token sign-in and survives ID token refreshes, so the deadline
 * is fixed no matter how often the session is refreshed. A missing auth_time counts as expired.
 */
export function impersonationState(claims: ImpersonationClaims, now = Date.now()): ImpersonationState {
  if (!claims.impersonatedBy) {
    return { impersonated: false };
  }
  const authTime = typeof claims.auth_time === "number" ? claims.auth_time : Number(claims.auth_time);
  const remainingMs = Number.isFinite(authTime) ? authTime * 1000 + impersonationSessionLifetimeMs - now : 0;
  return remainingMs > 0 ? { impersonated: true, expired: false, remainingMs } : { impersonated: true, expired: true };
}

/**
 * Lifetime for a new session cookie: never past the original deadline. undefined when less than Firebase's
 * five-minute minimum is left, in which case the cookie already in the browser (which ends by the same
 * deadline) is kept.
 */
export function impersonationCookieLifetimeMs(remainingMs: number): number | undefined {
  return remainingMs >= minSessionCookieMs ? remainingMs : undefined;
}
