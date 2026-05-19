import type { HttpMethodType } from "../../api";

export type AuthClass = "bearer" | "session";

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

export type RateLimitResult = {
  allowed: boolean;
  bucket: string;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSec: number;
};

export interface RateLimiter {
  check(opts: RateLimitOpts): Promise<RateLimitResult>;
}
