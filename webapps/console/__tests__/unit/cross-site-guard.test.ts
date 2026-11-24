import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerSession: vi.fn(), signOut: vi.fn(), checkOrAddToIngress: vi.fn() }));

vi.mock("../../lib/server/db", () => ({ db: { prisma: () => ({}) } }));
// The limiter keeps its counters in the database; here every request is allowed
vi.mock("../../lib/server/rate-limit", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/server/rate-limit")>()),
  getRateLimiter: () => ({
    check: async () => ({
      allowed: true,
      bucket: "test",
      limit: 1000,
      remaining: 999,
      retryAfterSec: 0,
      resetAt: new Date(),
    }),
  }),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("../../lib/server/firebase-server", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/server/firebase-server")>()),
  isFirebaseEnabled: () => false,
  signOut: mocks.signOut,
}));
vi.mock("../../lib/server/custom-domains", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/server/custom-domains")>()),
  checkOrAddToIngress: mocks.checkOrAddToIngress,
}));

import { createRoute } from "../../lib/api";
import { isCrossSiteRequest, shouldRefuseCrossSite } from "../../lib/server/cross-site";
import revokeSession from "../../pages/api/fb-auth/revoke-session";
import domainCheck from "../../pages/api/[workspaceId]/domain-check";

function response() {
  const res: any = { statusCode: 200, body: undefined as any, sent: false };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.send = (b: any) => {
    if (!res.sent) res.body = b;
    res.sent = true;
    return res;
  };
  res.json = res.send;
  res.setHeader = () => res;
  res.getHeader = () => undefined;
  res.end = () => res;
  return res;
}

async function call(
  handler: (req: any, res: any) => unknown,
  opts: { method?: string; site?: string; headers?: Record<string, string>; query?: Record<string, string> } = {}
) {
  const res = response();
  const headers: Record<string, string> = { cookie: "session=abc", ...opts.headers };
  if (opts.site !== undefined) headers["sec-fetch-site"] = opts.site;
  await handler(
    {
      method: opts.method ?? "GET",
      headers,
      query: opts.query ?? {},
      cookies: { session: "abc" },
      url: "/api/probe?x=1",
    },
    res
  );
  return res;
}

beforeEach(() => {
  mocks.getServerSession.mockReset().mockResolvedValue(null);
  mocks.signOut.mockReset();
  mocks.checkOrAddToIngress.mockReset();
});

describe("shouldRefuseCrossSite", () => {
  const route = { mutates: true };
  it.each([
    ["cross-site", true],
    ["CROSS-SITE", true],
    ["same-origin", false],
    ["same-site", false],
    ["none", false],
    [undefined, false],
  ])("a GET of a mutating route, Sec-Fetch-Site %s -> refused %s", (site, refused) => {
    const headers = site === undefined ? {} : { "sec-fetch-site": site };
    expect(shouldRefuseCrossSite({ method: "GET", headers }, route, false)).toBe(refused);
  });

  it("applies to GET and HEAD of a flagged route only", () => {
    const headers = { "sec-fetch-site": "cross-site" };
    expect(shouldRefuseCrossSite({ method: "HEAD", headers }, route, false)).toBe(true);
    expect(shouldRefuseCrossSite({ method: "POST", headers }, route, false)).toBe(false);
    expect(shouldRefuseCrossSite({ method: "GET", headers }, {}, false)).toBe(false);
    expect(shouldRefuseCrossSite({ method: "GET", headers }, { rejectCrossSite: true }, false)).toBe(true);
  });

  it("lets a request with its own bearer credential through", () => {
    expect(shouldRefuseCrossSite({ method: "GET", headers: { "sec-fetch-site": "cross-site" } }, route, true)).toBe(
      false
    );
  });

  it("reads the first value of a repeated header", () => {
    expect(isCrossSiteRequest({ "sec-fetch-site": ["cross-site", "same-origin"] })).toBe(true);
  });
});

describe("the API wrapper", () => {
  const route = (spec: Record<string, unknown>) => {
    const run = vi.fn(async () => ({ ok: true }));
    const handler = createRoute()
      .GET({ auth: false, ...spec } as any)
      .handler(run as any)
      .toNextApiHandler();
    return { handler, run };
  };

  it("refuses a cross-site GET of a route that changes state, before the handler and before any session lookup", async () => {
    const { handler, run } = route({ mutates: true });
    const res = await call(handler, { site: "cross-site" });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Cross-site request refused" });
    expect(run).not.toHaveBeenCalled();
    expect(mocks.getServerSession).not.toHaveBeenCalled();
  });

  it.each(["same-origin", "same-site", "none", undefined])("runs the same GET for Sec-Fetch-Site %s", async site => {
    const { handler, run } = route({ mutates: true });
    const res = await call(handler, { site });
    expect(res.statusCode).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs it for a cross-site caller that brings its own bearer credential, in a header or in the query", async () => {
    const { handler, run } = route({ mutates: true });
    await call(handler, { site: "cross-site", headers: { authorization: "Bearer key:secret" } });
    await call(handler, { site: "cross-site", query: { __unsafe_token: "key:secret" } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("leaves a GET that does not change state alone", async () => {
    const { handler, run } = route({});
    const res = await call(handler, { site: "cross-site" });
    expect(res.statusCode).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("refuses a flagged GET without `mutates`, which keeps the route available during maintenance", async () => {
    const { handler, run } = route({ rejectCrossSite: true });
    expect((await call(handler, { site: "cross-site" })).statusCode).toBe(403);
    expect((await call(handler, { site: "same-origin" })).statusCode).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("the routes that act on a GET", () => {
  it("revoke-session: a cross-site GET signs nobody out", async () => {
    const res = await call(revokeSession, { site: "cross-site" });
    expect(res.statusCode).toBe(403);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.getServerSession).not.toHaveBeenCalled();
  });

  it("domain-check: a cross-site GET provisions nothing", async () => {
    const res = await call(domainCheck, { site: "cross-site", query: { workspaceId: "w1", domain: "example.com" } });
    expect(res.statusCode).toBe(403);
    expect(mocks.checkOrAddToIngress).not.toHaveBeenCalled();
    expect(mocks.getServerSession).not.toHaveBeenCalled();
  });

  it("revoke-session with a signed-in user: signs out for a same-origin request, not for a cross-site one", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { email: "u@example.com", name: "U" },
      internalId: "u1",
      externalId: "ext1",
      externalUsername: "u@example.com",
      loginProvider: "firebase",
    });
    const headers = { host: "console.example.com" };
    expect((await call(revokeSession, { site: "cross-site", headers })).statusCode).toBe(403);
    expect(mocks.signOut).not.toHaveBeenCalled();
    await call(revokeSession, { site: "same-origin", headers });
    expect(mocks.signOut).toHaveBeenCalledWith("ext1");
  });

  it("both routes still reach the session check for a same-origin request", async () => {
    expect((await call(revokeSession, { site: "same-origin" })).statusCode).toBe(401);
    expect(
      (await call(domainCheck, { site: "same-origin", query: { workspaceId: "w1", domain: "example.com" } })).statusCode
    ).toBe(401);
    expect(mocks.getServerSession).toHaveBeenCalledTimes(2);
  });
});
