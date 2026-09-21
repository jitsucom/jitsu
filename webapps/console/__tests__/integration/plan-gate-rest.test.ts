import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { createHash, randomId } from "juava";
import { server } from "./support/msw";
import { deps, seedWorkspace } from "./support/harness";

// JITSU-228. Companion to plan-gate-mcp: drives the REAL Next.js API route,
// authenticated the way the public configuration API and the CLI authenticate
// (Authorization: Bearer <keyId>:<secret> against a UserApiToken row). Between
// the two files, "the gate cannot be bypassed by an API token" is executed
// rather than inferred from reading the call graph.

function onPlan(planId: string, extra: Record<string, any> = {}) {
  server.use(
    http.get("http://ee.test.local/api/billing/settings", () =>
      HttpResponse.json({ ok: true, subscriptionStatus: { planId, ...extra } })
    )
  );
}

beforeEach(() => {
  vi.stubEnv("EE_CONNECTION", "http://ee.test.local/");
  vi.stubEnv("EE_API_SERVICE_TOKEN", "test-service-token");
});

async function apiKeyFor(userInternalId: string) {
  const secret = randomId(24);
  const token = await deps().prisma.userApiToken.create({
    data: { hint: secret.slice(0, 3) + "***", hash: createHash(secret), userId: userInternalId },
  });
  return `${token.id}:${secret}`;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, any>,
    setHeader(n: string, v: any) {
      this.headers[n] = v;
    },
    getHeader(n: string) {
      return this.headers[n];
    },
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
    send(b: any) {
      this.body = b;
      return this;
    },
    end(b?: any) {
      if (b !== undefined) this.body = b;
      return this;
    },
  };
  return res;
}

async function postStream(bearer: string, workspaceId: string, body: any) {
  const handler = (await import("../../pages/api/[workspaceId]/config/[type]/index")).default;
  const req: any = {
    method: "POST",
    url: `/api/${workspaceId}/config/stream`,
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    query: { workspaceId, type: "stream" },
    body,
    socket: {},
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

describe("the plan gate holds through the real REST route", () => {
  it("refuses a domain on a denied plan, with 403", async () => {
    const { user, workspace } = await seedWorkspace();
    const bearer = await apiKeyFor(user.internalId);
    onPlan("free", { customDomainsEnabled: false });
    const res = await postStream(bearer, workspace.id, {
      id: `s-${randomId(6).toLowerCase()}`,
      name: "site",
      domains: [`rest-blocked-${randomId(6).toLowerCase()}.example.com`],
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/Business and Enterprise/);
  });

  it("allows the same call on a plan that permits it", async () => {
    const { user, workspace } = await seedWorkspace();
    const bearer = await apiKeyFor(user.internalId);
    onPlan("business");
    const res = await postStream(bearer, workspace.id, {
      id: `s-${randomId(6).toLowerCase()}`,
      name: "site",
      domains: [`rest-ok-${randomId(6).toLowerCase()}.example.com`],
    });
    expect(res.statusCode).toBe(200);
  });
});
