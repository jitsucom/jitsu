import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { authClientIp, isNextAuthAttempt, withAuthRateLimit } from "../../lib/server/rate-limit/auth";
import { deps } from "./support/harness";

function request(ip: string, action = "signin"): NextApiRequest {
  return {
    method: "POST",
    url: `/api/auth/${action}`,
    query: { nextauth: [action, "credentials"] },
    headers: { "x-real-ip": ip },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
}

async function call(handler: NextApiHandler, req: NextApiRequest) {
  let body: any;
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader(key: string, value: string) {
      headers[key] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  };
  await handler(req, res as unknown as NextApiResponse);
  return { status: res.statusCode, headers, body };
}

afterEach(() => vi.useRealTimers());

describe("anonymous authentication rate limits", () => {
  it("shares failed-attempt budgets across handlers, providers and concurrent requests", async () => {
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "3");
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    const failed: NextApiHandler = (_req, res) => res.status(401).json({ error: "invalid credentials" });
    const firstReplica = withAuthRateLimit(failed, { bucket: "login", matches: isNextAuthAttempt });
    const secondReplica = withAuthRateLimit(failed, { bucket: "login", matches: isNextAuthAttempt });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => {
        const req = request("192.0.2.17", i % 2 ? "callback" : "signin");
        if (i % 2) {
          req.method = "GET";
          req.query.nextauth = ["callback", "github"];
        }
        return call(i % 2 ? firstReplica : secondReplica, req);
      })
    );
    expect(results.filter(r => r.status === 401)).toHaveLength(3);
    expect(results.filter(r => r.status === 429)).toHaveLength(9);
    for (const r of results.filter(r => r.status === 429)) {
      expect(Number(r.headers["Retry-After"])).toBeGreaterThan(0);
      expect(r.headers["Cache-Control"]).toBe("no-store");
    }
    expect((await call(firstReplica, request("192.0.2.18"))).status).toBe(401);
    expect((await call(firstReplica, request("192.0.2.17", "session"))).status).toBe(401);
    expect((await call(firstReplica, request("192.0.2.17", "csrf"))).status).toBe(401);
    vi.setSystemTime(1_800_000_120_000);
    expect((await call(firstReplica, request("192.0.2.17"))).status).toBe(401);
  });

  it("keeps DB-independent session minting bounded during maintenance without writing counters", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("JITSU_CONSOLE_READ_ONLY", "true");
    vi.stubEnv("AUTH_SESSION_RATE_LIMIT", "2");
    const before = await deps().prisma.rateLimitCounter.count();
    const handler = withAuthRateLimit((_req, res) => res.status(200).json({ ok: true }), {
      bucket: "session",
      dbIndependent: true,
    });
    const req = request("192.0.2.19");
    expect((await call(handler, req)).status).toBe(200);
    expect((await call(handler, req)).status).toBe(200);
    expect((await call(handler, req)).status).toBe(429);
    expect(await deps().prisma.rateLimitCounter.count()).toBe(before);
  });

  it("fails closed on a store error for database-dependent auth routes", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    await deps().prisma.$executeRawUnsafe('ALTER TABLE newjitsu."RateLimitCounter" RENAME TO "RateLimitCounterHidden"');
    try {
      const handler = withAuthRateLimit(
        () => {
          throw new Error("must not call auth");
        },
        { bucket: "login" }
      );
      const result = await call(handler, request("192.0.2.20"));
      expect(result.status).toBe(503);
      expect(result.headers["Retry-After"]).toBe("5");
    } finally {
      await deps().prisma.$executeRawUnsafe(
        'ALTER TABLE newjitsu."RateLimitCounterHidden" RENAME TO "RateLimitCounter"'
      );
    }
  });

  it("canonicalizes IP aliases and ignores untrusted forwarded chains", () => {
    expect(authClientIp(request("2001:0db8:0:0:0:0:0:1"))).toBe("2001:db8::1");
    expect(authClientIp(request("::ffff:192.0.2.1"))).toBe("192.0.2.1");
    const req = request("not-an-ip");
    req.headers["x-forwarded-for"] = "192.0.2.99";
    expect(authClientIp(req)).toBe("127.0.0.1");
  });
});
