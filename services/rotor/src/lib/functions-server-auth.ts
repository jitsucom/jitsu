import { timingSafeEqual } from "node:crypto";
import { checkHash } from "juava";

/**
 * Bearer authentication for the functions-server HTTP API (JITSU-261). Its endpoints run user code for the workspace
 * named in the request, so a caller must prove it is one of our own services (rotor, the console).
 *
 * Off until tokens are configured, so existing deployments keep working until they roll out the key to the callers:
 *   FUNCTIONS_SERVER_AUTH_TOKENS      comma separated `${salt}.${hash}` values (see juava createHash)
 *   FUNCTIONS_SERVER_RAW_AUTH_TOKENS  comma separated plain tokens
 * Callers send the plain token as `Authorization: Bearer <token>`: rotor from FUNCTIONS_SERVER_AUTH_KEY, the
 * console from ROTOR_AUTH_KEY.
 */

export type FunctionsServerAuthEnv = {
  FUNCTIONS_SERVER_AUTH_TOKENS?: string;
  FUNCTIONS_SERVER_RAW_AUTH_TOKENS?: string;
};

function splitTokens(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(t => t.trim())
    .filter(Boolean);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function bearerToken(authorizationHeader: string | null | undefined): string | undefined {
  const match = /^bearer\s+(.+)$/i.exec(authorizationHeader ?? "");
  return match ? match[1].trim() : undefined;
}

export function createFunctionsServerAuth(env: FunctionsServerAuthEnv) {
  const hashed = splitTokens(env.FUNCTIONS_SERVER_AUTH_TOKENS);
  const raw = splitTokens(env.FUNCTIONS_SERVER_RAW_AUTH_TOKENS);
  const enabled = hashed.length > 0 || raw.length > 0;
  return {
    enabled,
    isAuthorized(authorizationHeader: string | null | undefined): boolean {
      if (!enabled) {
        return true;
      }
      const token = bearerToken(authorizationHeader);
      if (!token) {
        return false;
      }
      // every candidate is compared, so the time taken does not say which one matched
      let ok = false;
      for (const h of hashed) {
        ok = checkHash(h, token) || ok;
      }
      for (const r of raw) {
        ok = safeEqual(r, token) || ok;
      }
      return ok;
    },
  };
}

/** Headers a caller adds to authenticate to the functions-server. */
export function functionsServerAuthHeaders(key: string | undefined): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {};
}
