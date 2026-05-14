import type { RateLimitOpts, RateLimitResult } from "./types";

// Weighted-sliding-window decision. Given the current+previous window
// counts already incremented for this request, compute whether to allow.
// Pure — no I/O — so both PgRateLimiter and unit tests share one math path.
export function computeResult(opts: RateLimitOpts, current: number, previous: number, now: number): RateLimitResult {
  const W = opts.windowMs;
  const limit = opts.limit;
  const windowStartMs = Math.floor(now / W) * W;
  const elapsed = now - windowStartMs;
  const weightedTimesW = previous * (W - elapsed) + current * W;
  const limitTimesW = limit * W;
  const allowed = weightedTimesW <= limitTimesW;
  const remaining = Math.max(0, Math.floor((limitTimesW - weightedTimesW) / W));
  const retryAfterSec = allowed ? 0 : computeRetryAfterSec(opts, current, previous, now);
  const resetAt = allowed ? new Date(windowStartMs + W) : new Date(now + retryAfterSec * 1000);
  return { allowed, bucket: opts.bucket, limit, remaining, resetAt, retryAfterSec };
}

// Earliest second-rounded `t` from `now` at which a retry would no longer be
// denied, assuming no further requests arrive in between.
//
// Naive `ms-to-end-of-current-window` is wrong for sliding windows: when the
// current count is heavy, it carries into the next window as a fully-weighted
// `previous` and still drives `effective` over the limit. Solve for when
// `P × (1 − elapsed/W) + C + 1 ≤ limit` (within current window), or roll into
// the next window where the now-old `current` becomes `previous`.
function computeRetryAfterSec(opts: RateLimitOpts, current: number, previous: number, now: number): number {
  const W = opts.windowMs;
  const limit = opts.limit;
  const windowStartMs = Math.floor(now / W) * W;
  const elapsed = now - windowStartMs;

  // Within the current window: smallest integer `e` (ms) such that
  // previous × (W − e) + (current + 1) × W ≤ limit × W
  // → e ≥ ⌈W × (previous + current + 1 − limit) / previous⌉
  if (previous > 0 && limit - current - 1 >= 0) {
    const num = W * (previous + current + 1 - limit);
    const targetElapsed = num <= 0 ? 0 : Math.ceil(num / previous);
    if (targetElapsed <= W) {
      const t = Math.max(0, targetElapsed - elapsed);
      return Math.max(1, Math.ceil(t / 1000));
    }
  }

  // Cross into the next window where the current `current` becomes `previous`
  // and the retry contributes a fresh `current = 1`. Solve for smallest `e_new`
  // such that current × (W − e_new) + 1 × W ≤ limit × W.
  let elapsedNew = 0;
  if (current > 0 && limit > 1) {
    const num = W * (current + 1 - limit);
    elapsedNew = num <= 0 ? 0 : Math.ceil(num / current);
  } else if (current >= limit) {
    elapsedNew = W;
  }
  return Math.max(1, Math.ceil((W - elapsed + elapsedNew) / 1000));
}
