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

// What `peek` answers: the decision, and whether the recorded failures alone leave no room, whatever is in flight. When they do,
// checks in flight that end cannot change the answer.
export type PeekResult = RateLimitResult & { blockedByRecorded: boolean };

export interface RateLimiter {
  // Counts this request, then decides.
  check(opts: RateLimitOpts): Promise<RateLimitResult>;
  // Decides on what has been counted, without counting this request: for a budget of failures, which are recorded with
  // `check` only once they have happened. Allowed means one more failure still fits in the budget; `pending` is the number of
  // checks already admitted and not yet counted, which use up the budget too.
  peek(opts: RateLimitOpts, pending?: number): Promise<PeekResult>;
}
