import type { RateLimitResult } from "juava/src/rate-limit";
import type { RateLimitOpts } from "./types";

// The decision of a budget of failures, read without counting the request: is there room for one more failure?
//
// `computeResult` assumes the request it is asked about has been counted, so reading with it admits an address whose next
// failure no longer fits, and gives a Retry-After for a count that is never made. Here the admission test and the Retry-After
// are the same question, asked at different times: would one more failure still fit? The Retry-After is the first whole
// second at which the answer is yes, assuming nothing else is counted in the meantime.
//
// `pending` is the number of checks of this address that are in flight (admitted, not yet counted). They count against the
// current window only: they are over long before the next one.
export function peekResult(
  opts: RateLimitOpts,
  current: number,
  previous: number,
  pending: number,
  now: number
): RateLimitResult {
  const W = opts.windowMs;
  const base = Math.floor(now / W) * W;
  const fits = (at: number): boolean => {
    const start = Math.floor(at / W) * W;
    const windowsAhead = (start - base) / W;
    const c = windowsAhead === 0 ? current + pending : 0;
    const p = windowsAhead === 0 ? previous : windowsAhead === 1 ? current : 0;
    return p * (W - (at - start)) + (c + 1) * W <= opts.limit * W;
  };

  if (fits(now)) {
    const used = previous * (W - (now - base)) + (current + pending) * W;
    return {
      allowed: true,
      bucket: opts.bucket,
      limit: opts.limit,
      remaining: Math.max(0, Math.floor((opts.limit * W - used) / W)),
      resetAt: new Date(base + W),
      retryAfterSec: 0,
    };
  }
  let waitSec = 1;
  while (waitSec < (2 * W) / 1000 && !fits(now + waitSec * 1000)) waitSec++;
  return {
    allowed: false,
    bucket: opts.bucket,
    limit: opts.limit,
    remaining: 0,
    resetAt: new Date(now + waitSec * 1000),
    retryAfterSec: waitSec,
  };
}
