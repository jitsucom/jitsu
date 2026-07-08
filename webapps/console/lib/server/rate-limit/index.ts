import { getSingleton } from "juava";
import { db } from "../db";
import { PgRateLimiter } from "./pg";
import type { RateLimiter } from "./types";

export { getRateLimitOpts, setRateLimitHeaders } from "./extractor";
export type { AuthClass, RateLimitOpts, RateLimitResult, RateLimiter, RouteRateLimitSpec } from "./types";
export type { RouteRateLimitOverride } from "./types";

const rateLimiterSingleton = getSingleton<RateLimiter>(
  "rate-limiter",
  () => new PgRateLimiter({ prisma: db.prisma() }),
  {
    silent: true,
  }
);

export function getRateLimiter(): RateLimiter {
  return rateLimiterSingleton();
}
