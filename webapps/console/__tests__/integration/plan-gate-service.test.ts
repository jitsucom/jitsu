import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomId } from "juava";
import { http, HttpResponse } from "msw";
import { server } from "./support/msw";
import { deps, seedWorkspace } from "./support/harness";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { IDENTITY_STITCHING_FUNCTION_ID } from "../../lib/shared/plan-features";

// JITSU-228. The unit tests cover the resolvers and the gate helpers in
// isolation; this file is the one that proves the gates are actually WIRED into
// ConfigObjectsService — which is what "UI and backend enforcement agree"
// depends on, since the service is the single choke point behind the REST
// routes, the MCP server and the public configuration API.
//
// Real Postgres via the harness; ee-api faked with MSW so a workspace can be
// put on any plan. EE_CONNECTION is stubbed per-test because the integration
// setup deletes it (isEEAvailable() → false would skip every gate).

const svc = () => new ConfigObjectsService({ prisma: deps().prisma });

/** ConfigurationObject.id is globally unique, so every test needs its own. */
const oid = (p: string) => `${p}-${randomId(8).toLowerCase()}`;

/** Domains are unique across ALL workspaces, so tests cannot share one either. */
const dom = () => `${randomId(8).toLowerCase()}.example.com`;

let billingCalls = 0;

function onPlan(planId: string, extra: Record<string, any> = {}) {
  server.use(
    http.get("http://ee.test.local/api/billing/settings", () => {
      billingCalls++;
      return HttpResponse.json({ ok: true, subscriptionStatus: { planId, ...extra } });
    })
  );
}

beforeEach(() => {
  vi.stubEnv("EE_CONNECTION", "http://ee.test.local/");
  // Callers without an incoming request (the MCP server, background jobs) take
  // the serviceTokenHeaders() branch in fetchPlan, and that throws when this is
  // unset — which the gate would report as a 503 "plan unverified".
  vi.stubEnv("EE_API_SERVICE_TOKEN", "test-service-token");
  billingCalls = 0;
});

async function seedStreamAndDest(workspaceId: string) {
  const prisma = deps().prisma;
  const stream = await prisma.configurationObject.create({
    data: { workspaceId, type: "stream", config: { name: "site" } },
  });
  const dest = await prisma.configurationObject.create({
    data: { workspaceId, type: "destination", config: { name: "wh", destinationType: "webhook" } },
  });
  return { streamId: stream.id, destId: dest.id };
}

describe("custom domains gate, through ConfigObjectsService", () => {
  it("refuses a stream created with a domain on the free plan", async () => {
    const { user, workspace } = await seedWorkspace();
    const sid = oid("s");
    onPlan("free");
    await expect(
      svc().create(user, workspace.id, "stream", { id: sid, name: "site", domains: [dom()] })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows it on a paid plan", async () => {
    const { user, workspace } = await seedWorkspace();
    const sid = oid("s");
    onPlan("business");
    await expect(
      svc().create(user, workspace.id, "stream", { id: sid, name: "site", domains: [dom()] })
    ).resolves.toMatchObject({ id: sid });
  });

  it("refuses a standalone `domain` object too, not just stream.domains", async () => {
    const { user, workspace } = await seedWorkspace();
    onPlan("free");
    await expect(svc().create(user, workspace.id, "domain", { id: oid("d"), name: dom() })).rejects.toMatchObject({
      status: 403,
    });
  });

  // The grandfathering guarantee, at the service layer.
  it("lets a free workspace re-save a stream that already has a domain", async () => {
    const { user, workspace } = await seedWorkspace();
    const sid = oid("s");
    const existing = dom();
    onPlan("business");
    await svc().create(user, workspace.id, "stream", { id: sid, name: "site", domains: [existing] });
    onPlan("free");
    billingCalls = 0;
    await expect(svc().update(user, workspace.id, "stream", sid, { name: "renamed" })).resolves.toBeUndefined();
    expect(billingCalls).toBe(0);
  });

  it("refuses ADDING a domain to that grandfathered stream", async () => {
    const { user, workspace } = await seedWorkspace();
    const sid = oid("s");
    const existing = dom();
    onPlan("business");
    await svc().create(user, workspace.id, "stream", { id: sid, name: "site", domains: [existing] });
    onPlan("free");
    await expect(svc().update(user, workspace.id, "stream", sid, { domains: [existing, dom()] })).rejects.toMatchObject(
      { status: 403 }
    );
  });

  it("does not call billing at all for a stream with no domains", async () => {
    const { user, workspace } = await seedWorkspace();
    const sid = oid("s");
    onPlan("free");
    await expect(svc().create(user, workspace.id, "stream", { id: sid, name: "site" })).resolves.toMatchObject({
      id: sid,
    });
    expect(billingCalls).toBe(0);
  });
});

describe("identity stitching gate, through ConfigObjectsService", () => {
  const withStitching = { functions: [{ functionId: IDENTITY_STITCHING_FUNCTION_ID }] };

  it("refuses turning it on below enterprise", async () => {
    const { user, workspace } = await seedWorkspace();
    const { streamId, destId } = await seedStreamAndDest(workspace.id);
    onPlan("business");
    await expect(
      svc().upsertLink(user, workspace.id, { fromId: streamId, toId: destId, type: "push", data: withStitching } as any)
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows it on enterprise", async () => {
    const { user, workspace } = await seedWorkspace();
    const { streamId, destId } = await seedStreamAndDest(workspace.id);
    onPlan("enterprise");
    await expect(
      svc().upsertLink(user, workspace.id, { fromId: streamId, toId: destId, type: "push", data: withStitching } as any)
    ).resolves.toMatchObject({ created: true });
  });

  // The $custom trap: a negotiated enterprise contract arrives under a
  // different plan id and must not be locked out.
  it("allows a negotiated contract arriving as $custom", async () => {
    const { user, workspace } = await seedWorkspace();
    const { streamId, destId } = await seedStreamAndDest(workspace.id);
    onPlan("$custom", { customBilling: true });
    await expect(
      svc().upsertLink(user, workspace.id, { fromId: streamId, toId: destId, type: "push", data: withStitching } as any)
    ).resolves.toMatchObject({ created: true });
  });

  it("lets a connection that already has it be re-saved on a lower plan, with no billing call", async () => {
    const { user, workspace } = await seedWorkspace();
    const { streamId, destId } = await seedStreamAndDest(workspace.id);
    onPlan("enterprise");
    const { id } = await svc().upsertLink(user, workspace.id, {
      fromId: streamId,
      toId: destId,
      type: "push",
      data: withStitching,
    } as any);
    onPlan("business");
    billingCalls = 0;
    await expect(
      svc().updateLink(user, workspace.id, id, { data: { ...withStitching, extra: 1 } })
    ).resolves.toMatchObject({ updated: true });
    expect(billingCalls).toBe(0);
  });

  it("does not call billing for a connection without the function", async () => {
    const { user, workspace } = await seedWorkspace();
    const { streamId, destId } = await seedStreamAndDest(workspace.id);
    onPlan("free");
    await expect(
      svc().upsertLink(user, workspace.id, { fromId: streamId, toId: destId, type: "push", data: {} } as any)
    ).resolves.toMatchObject({ created: true });
    expect(billingCalls).toBe(0);
  });
});
