import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import tokenRoute from "../../pages/api/mcp/oauth/token";
import mcpRoute from "../../pages/api/mcp/[transport]";
import { getRateLimiter } from "../../lib/server/rate-limit";

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

afterEach(() => vi.unstubAllEnvs());

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

  it("does not share the budget with sign-in attempts", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "2");
    const ip = "198.51.100.12";
    for (let i = 0; i < 4; i++) {
      await getRateLimiter().check({
        authClass: "ip",
        principal: createHash(ip),
        method: "POST",
        bucket: "auth-login",
        limit: 2,
        windowMs: 60_000,
      });
    }
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
    expect(statuses).toEqual([401, 401, 401, 401, 429, 429]);
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThan(0);
    expect(blocked.body.error).toBe("rate_limit_exceeded");
    expect((await call(mcpRoute, badBearer("198.51.100.21"))).statusCode).toBe(401);
  });

  it("counts a request without a token, and a malformed one, as failed attempts too", async () => {
    vi.stubEnv("MINUTE_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("AUTH_ATTEMPT_RATE_LIMIT", "2");
    const ip = "198.51.100.22";
    const statuses: number[] = [];
    for (const authorization of [undefined, "Bearer malformed", undefined, undefined, undefined]) {
      const req = request(ip, { headers: { "x-real-ip": ip, ...(authorization ? { authorization } : {}) } });
      statuses.push((await call(mcpRoute, req)).statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
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
  it("reads a counter without changing it", async () => {
    const opts = {
      authClass: "ip" as const,
      principal: "peek-test",
      method: "POST" as const,
      bucket: "peek-bucket",
      limit: 2,
      windowMs: 60_000,
    };
    const limiter = getRateLimiter() as any;
    expect((await limiter.peek(opts)).allowed).toBe(true);
    expect((await limiter.peek(opts)).remaining).toBe(2);
    await limiter.check(opts);
    await limiter.check(opts);
    expect((await limiter.peek(opts)).allowed).toBe(true);
    await limiter.check(opts);
    const over = await limiter.peek(opts);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSec).toBeGreaterThan(0);
    // peeking again does not move it
    expect((await limiter.peek(opts)).allowed).toBe(false);
    expect(
      await deps().prisma.rateLimitCounter.findFirst({ where: { bucketKey: "ip:peek-test:peek-bucket" } })
    ).toMatchObject({ count: 3 });
  });
});
