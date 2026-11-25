import { describe, expect, it } from "vitest";
import { peekResult } from "../../lib/server/rate-limit/peek";

const W = 60_000;
const opts = (limit: number) => ({
  authClass: "ip" as const,
  principal: "p",
  method: "POST" as const,
  bucket: "b",
  limit,
  windowMs: W,
});

// the weighted sliding window, written out: one more failure fits when the weighted count with it is within the limit
function fitsAt(limit: number, current: number, previous: number, pending: number, now: number, at: number) {
  const base = Math.floor(now / W) * W;
  const start = Math.floor(at / W) * W;
  const ahead = (start - base) / W;
  const c = ahead === 0 ? current + pending : 0;
  const p = ahead === 0 ? previous : ahead === 1 ? current : 0;
  return p * (W - (at - start)) + (c + 1) * W <= limit * W;
}

describe("peekResult", () => {
  const start = 1_800_000_000_000 - (1_800_000_000_000 % W);

  it("admits while one more failure fits and refuses when it does not", () => {
    expect(peekResult(opts(3), 0, 0, 0, start).allowed).toBe(true);
    expect(peekResult(opts(3), 2, 0, 0, start).allowed).toBe(true);
    expect(peekResult(opts(3), 3, 0, 0, start).allowed).toBe(false);
  });

  it("counts the checks in flight", () => {
    expect(peekResult(opts(3), 1, 0, 1, start).allowed).toBe(true);
    expect(peekResult(opts(3), 1, 0, 2, start).allowed).toBe(false);
  });

  it("asks for a short wait when only the checks in flight use the budget up", () => {
    // 60 valid requests are being checked, 5 s into the minute, and none has failed: they are over in moments, not at the
    // end of the minute
    const result = peekResult(opts(60), 0, 0, 60, start + 5_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBe(1);
    // recorded failures that use the budget up by themselves still wait for the window
    expect(peekResult(opts(60), 60, 0, 0, start + 5_000).retryAfterSec).toBeGreaterThan(1);
    // and so do failures that use it up together with the checks in flight
    expect(peekResult(opts(60), 60, 0, 5, start + 5_000).retryAfterSec).toBeGreaterThan(1);
  });

  it("gives the Retry-After of the reviewed case: 59 failures, 2 in the previous minute, 10 s in", () => {
    const result = peekResult(opts(60), 59, 2, 0, start + 10_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBe(50);
    // and the address is really admitted at that moment, not before
    expect(fitsAt(60, 59, 2, 0, start + 10_000, start + 10_000 + 49_000)).toBe(false);
    expect(fitsAt(60, 59, 2, 0, start + 10_000, start + 10_000 + 50_000)).toBe(true);
  });

  it("admits again exactly at its Retry-After, over a grid of counts and moments", () => {
    let refused = 0;
    for (const limit of [1, 2, 3, 10, 60]) {
      for (const current of [0, 1, 2, limit - 1, limit, limit + 1, limit + 5]) {
        for (const previous of [0, 1, limit, limit + 3]) {
          for (const pending of [0, 1, 4]) {
            for (const elapsed of [0, 1_000, 15_500, 30_000, 59_999]) {
              if (current < 0) continue;
              const now = start + elapsed;
              const result = peekResult(opts(limit), current, previous, pending, now);
              expect(result.allowed).toBe(fitsAt(limit, current, previous, pending, now, now));
              if (result.allowed) {
                expect(result.retryAfterSec).toBe(0);
                continue;
              }
              refused++;
              const wait = result.retryAfterSec;
              expect(wait).toBeGreaterThan(0);
              // refused only because of the checks in flight: they end in moments
              if (pending > 0 && fitsAt(limit, current, previous, 0, now, now)) {
                expect(wait).toBe(1);
                continue;
              }
              expect(
                fitsAt(limit, current, previous, pending, now, now + wait * 1000),
                `limit ${limit} c${current} p${previous} f${pending} e${elapsed}: at ${wait}s`
              ).toBe(true);
              if (wait > 1) {
                expect(
                  fitsAt(limit, current, previous, pending, now, now + (wait - 1) * 1000),
                  `limit ${limit} c${current} p${previous} f${pending} e${elapsed}: at ${wait - 1}s`
                ).toBe(false);
              }
              expect(result.resetAt.getTime()).toBe(now + wait * 1000);
            }
          }
        }
      }
    }
    expect(refused).toBeGreaterThan(100);
  });
});
