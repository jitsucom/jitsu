import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "juava";
import { deps } from "./support/harness";
import { PgRateLimiter } from "../../lib/server/rate-limit/pg";
import type { RateLimitOpts } from "../../lib/server/rate-limit/types";

// The sliding-window ON CONFLICT upsert against newjitsu."RateLimitCounter",
// exercised against real Postgres. The window math itself is covered by the
// pure computeResult tests in __tests__/unit/rate-limit.test.ts — here we prove
// the SQL feeds it the right current/previous counts.

const W = 60_000;

function opts(principal: string, limit = 10): RateLimitOpts {
  return { authClass: "bearer", principal, method: "GET", bucket: "GET", limit, windowMs: W };
}

// Fake only Date (timers stay real — the pg driver needs them) so windowStart
// is deterministic and tests can place counters in specific windows.
afterEach(() => vi.useRealTimers());

describe("PgRateLimiter", () => {
  it("upserts the window counter (ON CONFLICT increments)", async () => {
    const limiter = new PgRateLimiter({ prisma: deps().prisma });
    const principal = `p-${randomId(6)}`;
    vi.useFakeTimers({ toFake: ["Date"] });
    const windowStart = Math.floor(1_800_000_000_000 / W) * W;
    vi.setSystemTime(windowStart); // exactly at window start: previous window has weight 0

    const first = await limiter.check(opts(principal));
    expect(first).toMatchObject({ allowed: true, remaining: 9 });
    const second = await limiter.check(opts(principal));
    expect(second).toMatchObject({ allowed: true, remaining: 8 });

    const row = await deps().prisma.rateLimitCounter.findFirstOrThrow({
      where: { bucketKey: `bearer:${principal}:GET` },
    });
    expect(row.count).toBe(2); // the ON CONFLICT path incremented, not inserted twice
    expect(row.windowStart.getTime()).toBe(windowStart);
    expect(row.expiresAt.getTime()).toBe(windowStart + W + 5 * 60_000);
  });

  it("counts the previous window into the sliding limit", async () => {
    const prisma = deps().prisma;
    const limiter = new PgRateLimiter({ prisma });
    const principal = `p-${randomId(6)}`;
    vi.useFakeTimers({ toFake: ["Date"] });
    const windowStart = Math.floor(1_800_000_000_000 / W) * W;

    // a full previous window: 10 requests
    await prisma.rateLimitCounter.create({
      data: {
        bucketKey: `bearer:${principal}:GET`,
        windowStart: new Date(windowStart - W),
        count: 10,
        expiresAt: new Date(windowStart + 5 * 60_000),
      },
    });

    // 1s into the new window the previous still weighs ~0.98 → 10×0.98 + 1 > 10 → denied
    vi.setSystemTime(windowStart + 1000);
    const early = await limiter.check(opts(principal));
    expect(early.allowed).toBe(false);
    expect(early.retryAfterSec).toBeGreaterThan(0);

    // 59s in, the previous window has decayed to ~0.017 → 10×0.017 + 2 ≤ 10 → allowed
    vi.setSystemTime(windowStart + W - 1000);
    const late = await limiter.check(opts(principal));
    expect(late.allowed).toBe(true);
  });
});
