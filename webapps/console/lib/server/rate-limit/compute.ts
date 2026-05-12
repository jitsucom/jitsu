import type { RateLimitOpts, RateLimitResult } from "./types";

// Weighted-sliding-window decision. Given the current+previous window
// counts already incremented for this request, compute whether to allow.
// Pure — no I/O — so both PgRateLimiter and unit tests share one math path.
export function computeResult(opts: RateLimitOpts, current: number, previous: number, now: number): RateLimitResult {
  const windowStartMs = Math.floor(now / opts.windowMs) * opts.windowMs;
  const elapsed = now - windowStartMs;
  const effective = previous * (1 - elapsed / opts.windowMs) + current;
  const allowed = effective <= opts.limit;
  const resetAt = new Date(windowStartMs + opts.windowMs);
  const remaining = Math.max(0, Math.floor(opts.limit - effective));
  const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000));
  return { allowed, bucket: opts.bucket, limit: opts.limit, remaining, resetAt, retryAfterSec };
}
