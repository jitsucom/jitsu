import type { HttpMethodType } from "../../api";

// "bearer" — API token; "session" — browser session cookie;
// "ip"      — unauthenticated endpoints rate-limited by client IP (e.g. DCR).
export type AuthClass = "bearer" | "session" | "ip";

export type RateLimitOpts = {
  authClass: AuthClass;
  principal: string;
  method: HttpMethodType;
  bucket: string;
  limit: number;
  windowMs: number;
};

export type RouteRateLimitOverride = {
  bucket?: string;
  bearer?: number;
  session?: number;
  windowMs?: number;
};

export type RouteRateLimitSpec = false | RouteRateLimitOverride;

export type { RateLimitResult } from "juava/src/rate-limit";
import type { RateLimitResult } from "juava/src/rate-limit";

export interface RateLimiter {
  // Counts this request, then decides.
  check(opts: RateLimitOpts): Promise<RateLimitResult>;
  // Decides on what has been counted, without counting this request: for a budget of failures, which are recorded with
  // `check` only once they have happened.
  peek(opts: RateLimitOpts): Promise<RateLimitResult>;
}
