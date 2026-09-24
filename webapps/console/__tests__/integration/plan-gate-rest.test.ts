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
// eslint-disable-next-line no-restricted-properties
process.env.CUSTOM_DOMAIN_CNAMES = "cname.jitsu.com";
// eslint-disable-next-line no-restricted-properties
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
  // INGMGR_URL is set for the whole file (see above), so the stream inputFilter
  // in the postStream tests now reaches ingress too. Without a default handler
  // those show up as unhandled outbound requests. Individual tests override
  // this with server.use() when they need to count the calls.
  server.use(http.get("http://ingmgr.test.local/api/domain", () => HttpResponse.json({ status: "ok" })));
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

async function postConfigTest(bearer: string, workspaceId: string, type: string, body: any) {
  const handler = (await import("../../pages/api/[workspaceId]/config/[type]/test")).default;
  const req: any = {
    method: "POST",
    url: `/api/${workspaceId}/config/${type}/test`,
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    query: { workspaceId, type },
    body,
    socket: {},
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

describe("the plan gate holds through the real REST route", () => {
  // An explicit customDomainsEnabled:false still denies a plan the fallback
  // would allow — kept here so the flag path stays covered through the real
  // route now that the free cases exercise the plan-id fallback instead.
  it("refuses a domain when the plan carries an explicit denial, with 403", async () => {
    const { user, workspace } = await seedWorkspace();
    const bearer = await apiKeyFor(user.internalId);
    onPlan("business", { customDomainsEnabled: false });
    const res = await postStream(bearer, workspace.id, {
      id: `s-${randomId(6).toLowerCase()}`,
      name: "site",
      domains: [`rest-flagdenied-${randomId(6).toLowerCase()}.example.com`],
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a domain on free with no entitlement flag at all, with 403", async () => {
    const { user, workspace } = await seedWorkspace();
    const bearer = await apiKeyFor(user.internalId);
    onPlan("free");
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

    onPlan("free");
    const res = await getDomainCheck(bearer, workspace.id, `check-${randomId(6).toLowerCase()}.example.com`);
    expect(res.statusCode).toBe(403);
    expect(ingressCalls, "a denied workspace must not reach ingress-manager at all").toBe(0);
  });

  // The grandfathering guarantee reaches this route too. DomainsEditor calls
  // domain-check on mount and on "Re-check" for every configured domain, so a
  // flat plan denial would render a Free workspace's existing, working domain
  // as an error — the opposite of "nothing already configured is taken away".
  it("still checks a domain the workspace already has, even on a denied plan", async () => {
    const { user, workspace } = await seedWorkspace();
    const bearer = await apiKeyFor(user.internalId);
    const existing = `grandfathered-${randomId(6).toLowerCase()}.example.com`;
    await deps().prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "stream", config: { name: "site", domains: [existing] } },
    });

    let ingressCalls = 0;
    server.use(
      http.get("http://ingmgr.test.local/api/domain", () => {
        ingressCalls++;
        return HttpResponse.json({ status: "ok" });
      })
    );

    onPlan("free");
    const res = await getDomainCheck(bearer, workspace.id, existing);
    expect(res.statusCode, "an already-attached domain must stay checkable").toBe(200);
    expect(ingressCalls).toBeGreaterThan(0);

    // ...but a domain it does not have is still refused.
    const fresh = await getDomainCheck(bearer, workspace.id, `new-${randomId(6).toLowerCase()}.example.com`);
    expect(fresh.statusCode, "a domain not already attached is still gated").toBe(403);
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

  it("refuses fresh domain provisioning from a read-only workspace member", async () => {
    const { user, workspace } = await seedWorkspace({ role: "analyst" });
    const bearer = await apiKeyFor(user.internalId);
    let ingressCalls = 0;
    server.use(
      http.get("http://ingmgr.test.local/api/domain", () => {
        ingressCalls++;
        return HttpResponse.json({ status: "ok" });
      })
    );

    onPlan("business");
    const res = await getDomainCheck(bearer, workspace.id, `readonly-${randomId(6).toLowerCase()}.example.com`);
    expect(res.statusCode).toBe(403);
    expect(ingressCalls, "a read-only member must not provision ingress").toBe(0);
  });
});

async function getEntitlements(bearer: string, workspaceId: string) {
  const handler = (await import("../../pages/api/[workspaceId]/entitlements")).default;
  const res = makeRes();
  await handler(
    {
      method: "GET",
      url: `/api/${workspaceId}/entitlements`,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      query: { workspaceId },
      socket: {},
    } as any,
    res
  );
  return res;
}

describe("workspace entitlements endpoint", () => {
  it("resolves Free and explicit grants using service auth without Firebase", async () => {
    const { user, workspace } = await seedWorkspace();
    const bearer = await apiKeyFor(user.internalId);
    onPlan("free");
    const free = await getEntitlements(bearer, workspace.id);
    expect(free.statusCode).toBe(200);
    expect(free.body).toEqual({ customDomains: false, identityStitching: false });
    onPlan("free", { customDomainsEnabled: true, identityStitchingEnabled: true });
    expect((await getEntitlements(bearer, workspace.id)).body).toEqual({
      customDomains: true,
      identityStitching: true,
    });
  });
  it("rejects anonymous and non-member requests before fetching billing", async () => {
    const { user, workspace } = await seedWorkspace({ member: false });
    const calls = vi.fn();
    server.use(
      http.get("http://ee.test.local/api/billing/settings", () => {
        calls();
        return HttpResponse.json({ ok: true, subscriptionStatus: { planId: "free" } });
      })
    );
    expect((await getEntitlements("", workspace.id)).statusCode).toBe(401);
    expect((await getEntitlements(await apiKeyFor(user.internalId), workspace.id)).statusCode).toBe(403);
    expect(calls).not.toHaveBeenCalled();
  });
  it("preserves the workspace grant during billing failure and reports stitching unknown", async () => {
    const { user, workspace } = await seedWorkspace();
    await deps().prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["misc"] } });
    server.use(http.get("http://ee.test.local/api/billing/settings", () => new HttpResponse(null, { status: 503 })));
    const res = await getEntitlements(await apiKeyFor(user.internalId), workspace.id);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ customDomains: true, identityStitching: null });
  });
});

describe("the stream test endpoint cannot bypass plan or role gates", () => {
  it("refuses a new domain on Free before ingress or Bulker is called", async () => {
    const { user, workspace } = await seedWorkspace();
    const bearer = await apiKeyFor(user.internalId);
    let ingressCalls = 0;
    let bulkerCalls = 0;
    server.use(
      http.get("http://ingmgr.test.local/api/domain", () => {
        ingressCalls++;
        return HttpResponse.json({ status: "ok" });
      }),
      http.post("http://bulker.test.local/test", () => {
        bulkerCalls++;
        return HttpResponse.json({ ok: true });
      })
    );
    onPlan("free");

    const res = await postConfigTest(bearer, workspace.id, "stream", {
      name: "site",
      domains: [`test-blocked-${randomId(6).toLowerCase()}.example.com`],
    });
    expect(res.statusCode).toBe(403);
    expect(ingressCalls).toBe(0);
    expect(bulkerCalls).toBe(0);
  });

  it("refuses arbitrary tests from a read-only member on an eligible plan", async () => {
    const { user, workspace } = await seedWorkspace({ role: "analyst" });
    const bearer = await apiKeyFor(user.internalId);
    let ingressCalls = 0;
    server.use(
      http.get("http://ingmgr.test.local/api/domain", () => {
        ingressCalls++;
        return HttpResponse.json({ status: "ok" });
      })
    );
    onPlan("business");

    const res = await postConfigTest(bearer, workspace.id, "stream", {
      name: "site",
      domains: [`test-readonly-${randomId(6).toLowerCase()}.example.com`],
    });
    expect(res.statusCode).toBe(403);
    expect(ingressCalls).toBe(0);
  });
});
