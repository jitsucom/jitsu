import type { RateLimitOpts, RateLimitResult } from "./types";

// Weighted-sliding-window decision. Given the current+previous window
// counts already incremented for this request, compute whether to allow.
// Pure — no I/O — so both PgRateLimiter and unit tests share one math path.
export function computeResult(opts: RateLimitOpts, current: number, previous: number, now: number): RateLimitResult {
  const W = opts.windowMs;
  const limit = opts.limit;
  const windowStartMs = Math.floor(now / W) * W;
  const elapsed = now - windowStartMs;
  const effective = previous * (1 - elapsed / W) + current;
  const allowed = effective <= limit;
  const resetAt = new Date(windowStartMs + W);
  const remaining = Math.max(0, Math.floor(limit - effective));
  const retryAfterSec = allowed ? 0 : computeRetryAfterSec(opts, current, previous, now);
  return { allowed, bucket: opts.bucket, limit, remaining, resetAt, retryAfterSec };
}

// Earliest second-rounded `t` from `now` at which a retry would no longer be
// denied, assuming no further requests arrive in between.
//
// Naive `ms-to-end-of-current-window` is wrong for sliding windows: when the
// current count is heavy, it carries into the next window as a fully-weighted
// `previous` and still drives `effective` over the limit. Solve for when
// `P × (1 - elapsed/W) + C + 1 ≤ limit` (within current window), or roll into
// the next window where the now-old `current` becomes `previous`.
function computeRetryAfterSec(opts: RateLimitOpts, current: number, previous: number, now: number): number {
  const W = opts.windowMs;
  const limit = opts.limit;
  const windowStartMs = Math.floor(now / W) * W;
  const elapsed = now - windowStartMs;

  // Try within current window: P × (1 - (elapsed+t)/W) + current + 1 ≤ limit
  if (previous > 0 && limit - current - 1 >= 0) {
    const targetElapsed = W * (1 - (limit - current - 1) / previous);
    if (targetElapsed <= W) {
      const t = Math.max(0, targetElapsed - elapsed);
      return Math.max(1, Math.ceil(t / 1000));
    }
  }

  // Otherwise: cross into next window where `previous` becomes `current`.
  // Find earliest elapsed_new where current × (1 - elapsed_new/W) + 1 ≤ limit.
  let elapsedNew = 0;
  if (current > 0 && limit > 1) {
    elapsedNew = Math.max(0, W * (1 - (limit - 1) / current));
  } else if (current >= limit) {
    elapsedNew = W;
  }
  return Math.max(1, Math.ceil((W - elapsed + elapsedNew) / 1000));
}
