import type { RateLimitOpts, RateLimitResult, RateLimiter } from "./types";

type Entry = { windowStart: number; current: number; previous: number };

// In-memory RateLimiter for unit tests. Same weighted-sliding-window math
// as PgRateLimiter; not safe across processes — do not use in production.
export class InMemoryRateLimiter implements RateLimiter {
  private readonly store = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  async check(opts: RateLimitOpts): Promise<RateLimitResult> {
    const key = `${opts.authClass}:${opts.principal}:${opts.bucket}`;
    const now = this.now();
    const windowStart = Math.floor(now / opts.windowMs) * opts.windowMs;
    const elapsed = now - windowStart;

    const existing = this.store.get(key);
    let current: number;
    let previous: number;
    if (!existing) {
      current = 1;
      previous = 0;
    } else if (existing.windowStart === windowStart) {
      current = existing.current + 1;
      previous = existing.previous;
    } else if (existing.windowStart === windowStart - opts.windowMs) {
      current = 1;
      previous = existing.current;
    } else {
      current = 1;
      previous = 0;
    }
    this.store.set(key, { windowStart, current, previous });

    const effective = previous * (1 - elapsed / opts.windowMs) + current;
    const allowed = effective <= opts.limit;
    const resetAt = new Date(windowStart + opts.windowMs);
    const remaining = Math.max(0, Math.floor(opts.limit - effective));
    const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000));

    return {
      allowed,
      bucket: opts.bucket,
      limit: opts.limit,
      remaining,
      resetAt,
      retryAfterSec,
    };
  }

  reset(): void {
    this.store.clear();
  }
}
