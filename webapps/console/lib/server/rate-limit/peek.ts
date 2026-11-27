import type { PeekResult, RateLimitOpts } from "./types";

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
): PeekResult {
  const W = opts.windowMs;
  const base = Math.floor(now / W) * W;
  const fits = (at: number, inFlight = pending): boolean => {
    const start = Math.floor(at / W) * W;
    const windowsAhead = (start - base) / W;
    const c = windowsAhead === 0 ? current + inFlight : 0;
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
      blockedByRecorded: false,
    };
  }
  // The wait is forecast from the recorded failures alone. The checks in flight are over in moments and mostly record no
  // failure, so they must not stretch it: when they alone cause the refusal this is 1 second, and when failures block the
  // address it is when those failures stop blocking it.
  let waitSec = 1;
  while (waitSec < (2 * W) / 1000 && !fits(now + waitSec * 1000, 0)) waitSec++;
  return refused(opts, now, waitSec, !fits(now, 0));
}

// The same decision for counters that were read at `readAt` and are answered at `now`, when the read has taken some time: the
// answer is given for the moment it returns, so a failure budget that recovers during the read is not reported as still blocked.
// When the minute moves on during the read, the counts of the minute it was read in belong to the minute before, or are gone.
export function peekResultAfterRead(
  opts: RateLimitOpts,
  current: number,
  previous: number,
  pending: number,
  readAt: number,
  now: number
): PeekResult {
  const answeredAt = Math.max(now, readAt);
  const W = opts.windowMs;
  const moved = Math.floor(answeredAt / W) - Math.floor(readAt / W);
  if (moved <= 0) return peekResult(opts, current, previous, pending, answeredAt);
  return peekResult(opts, 0, moved === 1 ? current : 0, pending, answeredAt);
}

function refused(opts: RateLimitOpts, now: number, waitSec: number, blockedByRecorded: boolean): PeekResult {
  return {
    allowed: false,
    bucket: opts.bucket,
    limit: opts.limit,
    remaining: 0,
    resetAt: new Date(now + waitSec * 1000),
    retryAfterSec: waitSec,
    blockedByRecorded,
  };
}
