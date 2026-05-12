import type { HttpMethodType } from "../../api";
import { getServerEnv } from "../serverEnv";
import type { AuthClass, RouteRateLimitOverride } from "./types";

// Multipliers applied to MINUTE_RATE_LIMIT_BASE when no explicit override is
// set. Reads are cheap (10–20×); writes are stricter (2–5×); deletes the
// strictest (1–2×). UI sessions get roughly 2× the budget of API tokens
// because the console polls a lot.
const MULTIPLIERS: Record<AuthClass, Partial<Record<HttpMethodType, number>>> = {
  bearer: { GET: 10, POST: 2, PUT: 2, PATCH: 2, DELETE: 1, OPTIONS: 20 },
  session: { GET: 20, POST: 5, PUT: 5, PATCH: 5, DELETE: 2, OPTIONS: 40 },
};

export const RATE_LIMIT_WINDOW_MS = 60_000;

export function resolveLimit(
  authClass: AuthClass,
  method: HttpMethodType,
  override?: RouteRateLimitOverride
): number {
  if (override && override[authClass] !== undefined) {
    return override[authClass]!;
  }
  const env = getServerEnv();
  const explicitKey = `MINUTE_RATE_LIMIT_${authClass.toUpperCase()}_${method}` as keyof typeof env;
  const explicit = env[explicitKey];
  if (typeof explicit === "number") {
    return explicit;
  }
  const mult = MULTIPLIERS[authClass][method] ?? 1;
  return Math.max(1, Math.floor(env.MINUTE_RATE_LIMIT_BASE * mult));
}

export function resolveWindowMs(override?: RouteRateLimitOverride): number {
  return override?.windowMs ?? RATE_LIMIT_WINDOW_MS;
}
