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

// custom-domains.ts captures CUSTOM_DOMAIN_CNAMES into a module-level const at
// import time, and the route modules are imported dynamically inside the tests
// below — so these have to be set here, at module scope, not in a beforeEach.
process.env.CUSTOM_DOMAIN_CNAMES = "cname.jitsu.com";
process.env.INGMGR_URL = "http://ingmgr.test.local";

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

async function getDomainCheck(bearer: string, workspaceId: string, domain: string) {
  const handler = (await import("../../pages/api/[workspaceId]/domain-check")).default;
  const req: any = {
    method: "GET",
    url: `/api/${workspaceId}/domain-check?domain=${domain}`,
    headers: { authorization: `Bearer ${bearer}` },
    query: { workspaceId, domain },
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

  // Raised by review on #1529. Config writes are not the only way to reach
  // ingress: this route calls checkOrAddToIngress() behind verifyAccess alone
  // and never touches ConfigObjectsService, so gating only the write left a
  // Free-plan member able to provision a certificate-map entry directly.
  it("refuses domain-check on a denied plan, before it can provision anything", async () => {
    const { user, workspace } = await seedWorkspace();
    const bearer = await apiKeyFor(user.internalId);
    let ingressCalls = 0;
    server.use(
      http.get("http://ingmgr.test.local/api/domain", () => {
        ingressCalls++;
        return HttpResponse.json({ status: "ok" });
      })
    );

    onPlan("free", { customDomainsEnabled: false });
    const res = await getDomainCheck(bearer, workspace.id, `check-${randomId(6).toLowerCase()}.example.com`);
    expect(res.statusCode).toBe(403);
    expect(ingressCalls, "a denied workspace must not reach ingress-manager at all").toBe(0);
  });

  it("still lets domain-check through on a plan that permits it", async () => {
    const { user, workspace } = await seedWorkspace();
    const bearer = await apiKeyFor(user.internalId);
    let ingressCalls = 0;
    server.use(
      http.get("http://ingmgr.test.local/api/domain", () => {
        ingressCalls++;
        return HttpResponse.json({ status: "ok" });
      })
    );

    onPlan("business");
    const res = await getDomainCheck(bearer, workspace.id, `check-${randomId(6).toLowerCase()}.example.com`);
    expect(res.statusCode).toBe(200);
    expect(ingressCalls, "an allowed workspace should still get its domain checked").toBeGreaterThan(0);
  });
});
