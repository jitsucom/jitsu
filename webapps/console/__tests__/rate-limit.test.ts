import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryRateLimiter } from "../lib/server/rate-limit/in-memory";
import { resolveLimit, resolveWindowMs, RATE_LIMIT_WINDOW_MS } from "../lib/server/rate-limit/config";
import { getRateLimitOpts, setRateLimitHeaders } from "../lib/server/rate-limit";
import type { SessionUser } from "../lib/schema";

// Stub serverEnv so resolveLimit / getRateLimitOpts see deterministic values.
vi.mock("../lib/server/serverEnv", () => {
  return {
    getServerEnv: () => ({
      MINUTE_RATE_LIMIT_ENABLED: true,
      MINUTE_RATE_LIMIT_BASE: 60,
      MINUTE_RATE_LIMIT_BEARER_GET: undefined,
      MINUTE_RATE_LIMIT_BEARER_POST: undefined,
      MINUTE_RATE_LIMIT_BEARER_PUT: undefined,
      MINUTE_RATE_LIMIT_BEARER_PATCH: undefined,
      MINUTE_RATE_LIMIT_BEARER_DELETE: undefined,
      MINUTE_RATE_LIMIT_SESSION_GET: undefined,
      MINUTE_RATE_LIMIT_SESSION_POST: undefined,
      MINUTE_RATE_LIMIT_SESSION_PUT: undefined,
      MINUTE_RATE_LIMIT_SESSION_PATCH: undefined,
      MINUTE_RATE_LIMIT_SESSION_DELETE: undefined,
    }),
  };
});

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

const fakeReq = {} as any;

describe("resolveLimit", () => {
  it("uses base × multiplier when no override", () => {
    expect(resolveLimit("bearer", "GET")).toBe(600); // 60 × 10
    expect(resolveLimit("bearer", "POST")).toBe(120); // 60 × 2
    expect(resolveLimit("session", "GET")).toBe(1200); // 60 × 20
    expect(resolveLimit("session", "DELETE")).toBe(120); // 60 × 2
  });

  it("route override beats base", () => {
    expect(resolveLimit("bearer", "POST", { bearer: 2 })).toBe(2);
    expect(resolveLimit("session", "POST", { session: 7 })).toBe(7);
  });

  it("route override applies only to the matching auth class", () => {
    expect(resolveLimit("bearer", "POST", { session: 999 })).toBe(120);
  });

  it("resolveWindowMs returns default when no override", () => {
    expect(resolveWindowMs()).toBe(RATE_LIMIT_WINDOW_MS);
    expect(resolveWindowMs({ windowMs: 5 * 60_000 })).toBe(5 * 60_000);
  });
});

describe("getRateLimitOpts", () => {
  it("returns null when no user", () => {
    expect(getRateLimitOpts(fakeReq, undefined, { method: "GET" })).toBeNull();
  });

  it("returns null for the admin service account", () => {
    expect(getRateLimitOpts(fakeReq, adminUser, { method: "GET" })).toBeNull();
  });

  it("returns null when rateLimit: false", () => {
    expect(getRateLimitOpts(fakeReq, bearerUser, { method: "GET", rateLimit: false })).toBeNull();
  });

  it("classifies bearer auth by tokenId", () => {
    const opts = getRateLimitOpts(fakeReq, bearerUser, { method: "GET" });
    expect(opts).toMatchObject({ authClass: "bearer", principal: "tok-1", bucket: "GET", limit: 600 });
  });

  it("classifies session auth by internalId", () => {
    const opts = getRateLimitOpts(fakeReq, sessionUser, { method: "POST" });
    expect(opts).toMatchObject({ authClass: "session", principal: "user-2", bucket: "POST", limit: 300 });
  });

  it("applies per-route bucket override", () => {
    const opts = getRateLimitOpts(fakeReq, bearerUser, {
      method: "POST",
      rateLimit: { bucket: "workspace-create", bearer: 2, windowMs: 5 * 60_000 },
    });
    expect(opts).toMatchObject({ bucket: "workspace-create", limit: 2, windowMs: 5 * 60_000 });
  });
});

describe("InMemoryRateLimiter sliding-window", () => {
  let now = 0;
  let limiter: InMemoryRateLimiter;
  const advance = (ms: number) => {
    now += ms;
  };
  const baseOpts = {
    authClass: "bearer" as const,
    principal: "tok-1",
    method: "GET" as const,
    bucket: "GET",
    limit: 5,
    windowMs: 60_000,
  };

  beforeEach(() => {
    now = 1_700_000_000_000;
    limiter = new InMemoryRateLimiter({ now: () => now });
  });

  it("decreases remaining monotonically within a window", async () => {
    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await limiter.check(baseOpts);
      results.push(r.remaining);
    }
    expect(results).toEqual([4, 3, 2, 1, 0, 0]);
  });

  it("flips allowed=false at the boundary and reports retryAfter", async () => {
    for (let i = 0; i < 5; i++) await limiter.check(baseOpts);
    const denied = await limiter.check(baseOpts);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(denied.resetAt.getTime()).toBeGreaterThan(now);
  });

  it("previous window decays linearly into the new window", async () => {
    for (let i = 0; i < 5; i++) await limiter.check(baseOpts);
    // jump to the very start of the next window
    advance(60_000 - (now % 60_000));
    // at start of new window, previous count = 5, weight ≈ 1, current = 1 → effective ≈ 6 → denied
    const atStart = await limiter.check(baseOpts);
    expect(atStart.allowed).toBe(false);
    // advance halfway through the new window — previous weight = 0.5 → effective ≈ 5*0.5 + 2 = 4.5 → allowed
    advance(30_000);
    const mid = await limiter.check(baseOpts);
    expect(mid.allowed).toBe(true);
  });

  it("separates counters by bucket key", async () => {
    for (let i = 0; i < 5; i++) await limiter.check({ ...baseOpts, bucket: "GET" });
    const otherBucket = await limiter.check({ ...baseOpts, bucket: "POST" });
    expect(otherBucket.allowed).toBe(true);
    expect(otherBucket.remaining).toBe(4);
  });
});

describe("setRateLimitHeaders", () => {
  it("writes Limit/Remaining/Reset and never Retry-After", () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
    const resetAt = new Date(2_000_000_000_000);
    setRateLimitHeaders(res, {
      allowed: true,
      bucket: "GET",
      limit: 600,
      remaining: 599,
      resetAt,
      retryAfterSec: 0,
    });
    expect(headers["X-RateLimit-Limit"]).toBe("600");
    expect(headers["X-RateLimit-Remaining"]).toBe("599");
    expect(headers["X-RateLimit-Reset"]).toBe(String(Math.floor(resetAt.getTime() / 1000)));
    expect(headers["Retry-After"]).toBeUndefined();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
