import { describe, expect, it, vi } from "vitest";
import { resolveLimit } from "../lib/server/rate-limit/config";
import { computeResult } from "../lib/server/rate-limit/compute";
import { getRateLimitOpts } from "../lib/server/rate-limit/extractor";
import type { SessionUser } from "../lib/schema";

vi.mock("../lib/server/serverEnv", () => ({
  getServerEnv: () => ({
    MINUTE_RATE_LIMIT_ENABLED: true,
    MINUTE_RATE_LIMIT_BASE: 60,
  }),
}));

const bearerUser: SessionUser = {
  internalId: "user-1",
  externalUsername: "u1",
  externalId: "u1",
  loginProvider: "api",
  email: "u1@example.com",
  name: "u1",
  authType: "bearer",
  tokenId: "tok-1",
};

const sessionUser: SessionUser = {
  internalId: "user-2",
  externalUsername: "u2",
  externalId: "u2",
  loginProvider: "google",
  email: "u2@example.com",
  name: "u2",
  authType: "next-auth",
};

const adminUser: SessionUser = {
  internalId: "admin-service-account@jitsu.com",
  externalUsername: "admin",
  externalId: "admin",
  loginProvider: "admin/token",
  email: "admin-service-account@jitsu.com",
  name: "admin",
  authType: "bearer",
  tokenId: "admin-tok",
};

describe("resolveLimit", () => {
  it("derives from base × multiplier", () => {
    expect(resolveLimit("bearer", "GET")).toBe(600); // 60 × 10
    expect(resolveLimit("bearer", "POST")).toBe(120); // 60 × 2
    expect(resolveLimit("session", "GET")).toBe(1200); // 60 × 20
  });

  it("route override beats base, scoped to the matching auth class", () => {
    expect(resolveLimit("bearer", "POST", { bearer: 2 })).toBe(2);
    expect(resolveLimit("bearer", "POST", { session: 999 })).toBe(120);
  });
});

describe("getRateLimitOpts", () => {
  const req = {} as any;

  it("returns null for no user, admin service account, or rateLimit:false", () => {
    expect(getRateLimitOpts(req, undefined, { method: "GET" })).toBeNull();
    expect(getRateLimitOpts(req, adminUser, { method: "GET" })).toBeNull();
    expect(getRateLimitOpts(req, bearerUser, { method: "GET", rateLimit: false })).toBeNull();
  });

  it("classifies bearer by tokenId and session by internalId", () => {
    expect(getRateLimitOpts(req, bearerUser, { method: "GET" })).toMatchObject({
      authClass: "bearer",
      principal: "tok-1",
    });
    expect(getRateLimitOpts(req, sessionUser, { method: "POST" })).toMatchObject({
      authClass: "session",
      principal: "user-2",
    });
  });

  it("applies per-route bucket + limit + window override", () => {
    expect(
      getRateLimitOpts(req, bearerUser, {
        method: "POST",
        rateLimit: { bucket: "workspace-create", bearer: 2, windowMs: 5 * 60_000 },
      })
    ).toMatchObject({ bucket: "workspace-create", limit: 2, windowMs: 5 * 60_000 });
  });
});

describe("computeResult sliding window", () => {
  const W = 60_000;
  const opts = {
    authClass: "bearer" as const,
    principal: "p",
    method: "GET" as const,
    bucket: "GET",
    limit: 10,
    windowMs: W,
  };
  const winStart = 1_700_000_000_000;

  it("under limit → allowed, remaining floor(limit - effective)", () => {
    // start of window, previous=0, current=3 → effective=3, remaining=7
    const r = computeResult(opts, 3, 0, winStart);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(7);
    expect(r.retryAfterSec).toBe(0);
  });

  it("over limit → denied with Retry-After ≥ 1 sec to reset", () => {
    // end of window: previous=0, current=11 → effective=11 > 10
    const r = computeResult(opts, 11, 0, winStart + W - 1);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("previous window decays linearly across the new window", () => {
    // Halfway into new window: previous=10 weighted by 0.5, current=4 → effective=9 → allowed.
    expect(computeResult(opts, 4, 10, winStart + W / 2).allowed).toBe(true);
    // Same input at the start of the new window: previous weight ≈ 1, effective=14 → denied.
    expect(computeResult(opts, 4, 10, winStart).allowed).toBe(false);
  });

  it("Retry-After waits past the boundary when current would carry over", () => {
    // Reviewer case: previous=0, current=11 near end of current window. Naive
    // retry = 1s lands at start of next window where previous becomes 11 and
    // the retry would still be denied. Math must look further ahead.
    const denied = computeResult(opts, 11, 0, winStart + W - 1000);
    expect(denied.allowed).toBe(false);
    // 1s to window boundary + ~W × (1 - 9/11) ≈ 10.9s decay = ~12s total.
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(11);
  });

  it("retrying exactly at the advertised Retry-After instant is allowed (FP boundary)", () => {
    // Reviewer repro: limit=2, current=12, previous=0 at window start. The naive
    // FP form `previous * (1 - elapsed/W) + current` evaluates a valid retry to
    // 2.0000000000000004 > 2 and re-denies, violating the Retry-After contract.
    // Integer-scaled math must accept the retry exactly at the advertised instant.
    const tight = { ...opts, limit: 2 };
    const denied = computeResult(tight, 12, 0, winStart);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
    // At retry: original `current` (12) becomes `previous`; the retry itself is current=1.
    const retryAt = winStart + denied.retryAfterSec * 1000;
    expect(computeResult(tight, 1, 12, retryAt).allowed).toBe(true);
  });

  it("resetAt for denied requests aligns with Retry-After (not the window boundary)", () => {
    // Same near-boundary scenario as above: the current window ends in 1s,
    // but the limiter actually requires waiting ≥11s. resetAt must reflect
    // the real retry-allowed instant so X-RateLimit-Reset doesn't tell
    // clients to retry earlier than Retry-After.
    const now = winStart + W - 1000;
    const denied = computeResult(opts, 11, 0, now);
    expect(denied.allowed).toBe(false);
    expect(denied.resetAt.getTime() - now).toBe(denied.retryAfterSec * 1000);
    expect(denied.resetAt.getTime() - now).toBeGreaterThanOrEqual(11_000);

    // Allowed requests still report the window boundary (unchanged behavior).
    const allowed = computeResult(opts, 3, 0, winStart);
    expect(allowed.allowed).toBe(true);
    expect(allowed.resetAt.getTime()).toBe(Math.floor(winStart / W) * W + W);
  });
});
