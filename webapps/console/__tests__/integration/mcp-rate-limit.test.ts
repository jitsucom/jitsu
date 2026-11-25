import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash as nodeHash } from "node:crypto";
import { createHash } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import tokenRoute from "../../pages/api/mcp/oauth/token";
import mcpRoute from "../../pages/api/mcp/[transport]";
import { getRateLimiter } from "../../lib/server/rate-limit";
import { withAuthRateLimit } from "../../lib/server/rate-limit/auth";

// Failed attempts at the OAuth token endpoint and at the MCP endpoint were not counted anywhere: the limiter ran only after
// authentication, or not at all. These tests call the real route handlers over a real database.

function request(ip: string, extra: Record<string, unknown> = {}) {
  return {
    method: "POST",
    url: "/api/mcp/test",
    query: {},
    body: {},
    headers: { "x-real-ip": ip },
    socket: { remoteAddress: "127.0.0.1" },
    ...extra,
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, any>,
    headersSent: false,
    writableEnded: false,
    setHeader(name: string, value: any) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
    send(payload: any) {
      return this.json(payload);
    },
    end() {
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
  };
  return res;
}

async function call(handler: (req: any, res: any) => unknown, req: any) {
  const res = makeRes();
  await handler(req, res);
  return res;
}

const badToken = (ip: string) =>
  request(ip, {
    body: { grant_type: "refresh_token", refresh_token: "a:b", client_id: "no-such-client", client_secret: "wrong" },
  });
const badBearer = (ip: string, authorization = "Bearer nosuchtoken:wrongsecret") =>
  request(ip, { headers: { "x-real-ip": ip, authorization } });

async function seedApiKey(secret: string) {
  const { user } = await seedWorkspace();
  const token = await deps().prisma.userApiToken.create({
    data: { hint: secret.slice(0, 3) + "***", hash: createHash(secret), userId: user.internalId },
  });
  return `${token.id}:${secret}`;
}

// The counters are per minute: the clock stands still in the middle of the current minute, so that no test depends on where
// in the minute it happens to run. It is taken from the real clock, not a fixed date: the database removes counters whose
// expiry has passed by ITS clock, so a frozen date in the past would let a cleanup delete the rows of a running test.
let windowStart = 0;
beforeEach(() => {
  windowStart = Math.floor(Date.now() / 60_000) * 60_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(windowStart + 30_000);
  // the tests tell clients apart by X-Real-IP; a developer's own setting of it must not decide whether they pass
  vi.stubEnv("AUTH_TRUST_X_REAL_IP", "true");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/mcp/oauth/token", () => {
  it("counts every attempt per IP and answers 429 with Retry-After past the budget", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "3");
    const statuses: number[] = [];
    let blocked: any;
    for (let i = 0; i < 6; i++) {
      const res = await call(tokenRoute, badToken("198.51.100.10"));
      statuses.push(res.statusCode);
      if (res.statusCode === 429) blocked = res;
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429, 429]);
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThan(0);
    expect(blocked.body.error).toBe("rate_limit_exceeded");
    // another address has its own budget
    expect((await call(tokenRoute, badToken("198.51.100.11"))).statusCode).toBe(401);
  });

  it("charges the address the request comes from when X-Real-IP is not trusted", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "2");
    // a caller that reaches the console directly picks the address it is charged to, one new value per request
    const rotating = (i: number) => badToken(`198.51.100.${100 + i}`);
    vi.stubEnv("AUTH_TRUST_X_REAL_IP", "true");
    for (let i = 0; i < 4; i++) expect((await call(tokenRoute, rotating(i))).statusCode).toBe(401);
    vi.stubEnv("AUTH_TRUST_X_REAL_IP", "false");
    const statuses: number[] = [];
    for (let i = 10; i < 14; i++) statuses.push((await call(tokenRoute, rotating(i))).statusCode);
    expect(statuses).toEqual([401, 401, 429, 429]);
  });

  it("does not share the budget with sign-in attempts", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "2");
    const ip = "198.51.100.12";
    // the counter sign-in attempts of this address use: withAuthRateLimit keys it by a plain SHA-256 of the address (juava's
    // createHash is salted with a new random value on every call, so it would seed a counter nobody reads)
    const principal = nodeHash("sha256").update(ip).digest("hex");
    for (let i = 0; i < 4; i++) {
      await getRateLimiter().check({
        authClass: "ip",
        principal,
        method: "POST",
        bucket: "auth-login",
        limit: 2,
        windowMs: 60_000,
      });
    }
    // the sign-in budget of this address is used up: a request to the login bucket is refused
    const signIn = withAuthRateLimit((_req, res) => res.status(401).json({ error: "invalid credentials" }), {
      bucket: "login",
    });
    expect((await call(signIn, badToken(ip))).statusCode).toBe(429);
    // and the token endpoint does not share it
    expect((await call(tokenRoute, badToken(ip))).statusCode).toBe(401);
  });

  it("does nothing when the limiter is switched off", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "false");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "1");
    for (let i = 0; i < 4; i++) {
      expect((await call(tokenRoute, badToken("198.51.100.13"))).statusCode).toBe(401);
    }
  });
});

describe("the MCP endpoint", () => {
  it("counts failed bearer attempts per IP and answers 429 with Retry-After past the budget", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "3");
    const statuses: number[] = [];
    let blocked: any;
    for (let i = 0; i < 6; i++) {
      const res = await call(mcpRoute, badBearer("198.51.100.20"));
      statuses.push(res.statusCode);
      if (res.statusCode === 429) blocked = res;
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429, 429]);
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThan(0);
    expect(blocked.body.error).toBe("rate_limit_exceeded");
    expect((await call(mcpRoute, badBearer("198.51.100.21"))).statusCode).toBe(401);
  });

  it("counts a request without a token, and a malformed one, as failed attempts too", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "2");
    const ip = "198.51.100.22";
    const statuses: number[] = [];
    for (const authorization of [undefined, "Bearer malformed", undefined, undefined]) {
      const req = request(ip, { headers: { "x-real-ip": ip, ...(authorization ? { authorization } : {}) } });
      statuses.push((await call(mcpRoute, req)).statusCode);
    }
    expect(statuses).toEqual([401, 401, 429, 429]);
  });

  it("does not count requests that authenticate, however many there are", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "3");
    const ip = "198.51.100.23";
    const bearer = await seedApiKey("validsecret-295");
    for (let i = 0; i < 12; i++) {
      const res = await call(mcpRoute, badBearer(ip, `Bearer ${bearer}`));
      expect(res.statusCode, `valid request ${i}`).not.toBe(429);
      expect(res.statusCode, `valid request ${i}`).not.toBe(401);
    }
    // nothing was counted against the address: a failure is still answered, not refused
    expect((await call(mcpRoute, badBearer(ip))).statusCode).toBe(401);
  });

  it("does not let a burst of parallel failures past the budget before the first one is counted", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "3");
    const ip = "198.51.100.26";
    const results = await Promise.all(Array.from({ length: 30 }, () => call(mcpRoute, badBearer(ip))));
    const statuses = results.map(r => r.statusCode);
    // the budget is 3 failures: no more than 3 of the 30 reach the token check, and the rest are refused at once. Requests
    // that are refused still hold a place while they are decided, so a burst may admit fewer than 3, never more
    const admitted = statuses.filter(s => s === 401).length;
    expect(admitted).toBeGreaterThanOrEqual(1);
    expect(admitted).toBeLessThanOrEqual(3);
    expect(statuses.filter(s => s === 429).length).toBe(30 - admitted);
    expect(Number(results.find(r => r.statusCode === 429).headers["Retry-After"])).toBeGreaterThan(0);
    // exactly the admitted failures are counted
    const counter = await deps().prisma.rateLimitCounter.findFirst({
      where: { bucketKey: `ip:${nodeHash("sha256").update(ip).digest("hex")}:auth-failed-mcp` },
    });
    expect(counter?.count).toBe(admitted);
    // another address is not affected
    expect((await call(mcpRoute, badBearer("198.51.100.27"))).statusCode).toBe(401);
  });

  it("does nothing when the limiter is switched off", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "false");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "1");
    for (let i = 0; i < 4; i++) {
      expect((await call(mcpRoute, badBearer("198.51.100.24"))).statusCode).toBe(401);
    }
  });

  it("refuses with 503 when the counters cannot be read, and never reaches authentication", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    await deps().prisma.$executeRawUnsafe('ALTER TABLE newjitsu."RateLimitCounter" RENAME TO "RateLimitCounterHidden"');
    try {
      const res = await call(mcpRoute, badBearer("198.51.100.25"));
      expect(res.statusCode).toBe(503);
      expect(res.headers["Retry-After"]).toBe("5");
    } finally {
      await deps().prisma.$executeRawUnsafe(
        'ALTER TABLE newjitsu."RateLimitCounterHidden" RENAME TO "RateLimitCounter"'
      );
    }
  });
});

describe("the limiter's peek", () => {
  const opts = {
    authClass: "ip" as const,
    principal: "peek-test",
    method: "POST" as const,
    bucket: "peek-bucket",
    limit: 2,
    windowMs: 60_000,
  };

  it("reads a counter without changing it, and refuses once one more failure would not fit", async () => {
    const limiter = getRateLimiter() as any;
    expect((await limiter.peek(opts)).allowed).toBe(true);
    expect((await limiter.peek(opts)).remaining).toBe(2);
    await limiter.check(opts);
    expect((await limiter.peek(opts)).allowed).toBe(true);
    await limiter.check(opts);
    // two failures are counted and the budget is two: the next one is refused
    const over = await limiter.peek(opts);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSec).toBeGreaterThan(0);
    // peeking again does not move it
    expect((await limiter.peek(opts)).allowed).toBe(false);
    expect(
      await deps().prisma.rateLimitCounter.findFirst({ where: { bucketKey: "ip:peek-test:peek-bucket" } })
    ).toMatchObject({ count: 2 });
  });

  it("counts the checks in flight against the budget", async () => {
    const limiter = getRateLimiter() as any;
    const own = { ...opts, principal: "peek-pending" };
    await limiter.check(own);
    expect((await limiter.peek(own, 0)).allowed).toBe(true);
    expect((await limiter.peek(own, 1)).allowed).toBe(false);
  });

  it("gives a Retry-After at which the address is admitted again, and not a second sooner", async () => {
    const limiter = getRateLimiter() as any;
    // 59 failures in this minute and 2 in the previous one, 10 s into the minute (the case a reviewer worked out)
    const big = { ...opts, principal: "peek-retry", bucket: "peek-retry-bucket", limit: 60 };
    const key = "ip:peek-retry:peek-retry-bucket";
    const expiresAt = new Date(windowStart + 600_000);
    await deps().prisma.rateLimitCounter.create({
      data: { bucketKey: key, windowStart: new Date(windowStart), count: 59, expiresAt },
    });
    await deps().prisma.rateLimitCounter.create({
      data: { bucketKey: key, windowStart: new Date(windowStart - 60_000), count: 2, expiresAt },
    });
    const at = (offsetMs: number) => vi.setSystemTime(windowStart + 10_000 + offsetMs);
    at(0);
    const refused = await limiter.peek(big);
    expect(refused.allowed).toBe(false);
    const wait = refused.retryAfterSec;
    expect(wait).toBeGreaterThan(0);
    at((wait - 1) * 1000);
    expect((await limiter.peek(big)).allowed, "one second before Retry-After").toBe(false);
    at(wait * 1000);
    expect((await limiter.peek(big)).allowed, "at Retry-After").toBe(true);
  });
});
