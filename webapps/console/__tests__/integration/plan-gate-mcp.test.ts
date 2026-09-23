import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./support/msw";
import { deps, seedWorkspace } from "./support/harness";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { registerTools } from "../../lib/server/mcp-server/tools";
import { IDENTITY_STITCHING_FUNCTION_ID } from "../../lib/shared/plan-features";

// JITSU-228. The other tests call ConfigObjectsService directly. The ticket's
// headline promise is that the gate "cannot be bypassed" by the MCP server,
// the CLI or the configuration API — and until this file existed, that rested
// on having read the code rather than run it. This drives the REAL MCP tool
// handler, registered exactly as the MCP server registers it.

const tools = new Map<string, (args: any, ctx: any) => Promise<any>>();

/** Minimal stand-in for the MCP SDK server: capture the registered handlers. */
const fakeSdkServer: any = {
  registerTool: (name: string, _config: any, cb: any) => {
    tools.set(name, cb);
  },
};

function onPlan(planId: string, extra: Record<string, any> = {}) {
  server.use(
    http.get("http://ee.test.local/api/billing/settings", () =>
      HttpResponse.json({ ok: true, subscriptionStatus: { planId, ...extra } })
    )
  );
}

const noop: any = new Proxy({}, { get: () => () => undefined });

beforeEach(() => {
  vi.stubEnv("EE_CONNECTION", "http://ee.test.local/");
  vi.stubEnv("EE_API_SERVICE_TOKEN", "test-service-token");
  tools.clear();
  registerTools(fakeSdkServer, {
    service: new ConfigObjectsService({ prisma: deps().prisma }),
    eventsLog: noop,
    syncs: noop,
    debug: noop,
    reports: noop,
    auditLog: noop,
    req: { headers: { host: "console.test.local" } } as any,
  });
});

const ctxFor = (user: { internalId: string; email: string }) => ({
  authInfo: { extra: { userId: user.internalId, email: user.email } },
});

/** The MCP layer turns thrown errors into an isError result rather than rejecting. */
const textOf = (r: any) => (r?.content ?? []).map((c: any) => c.text).join(" ");

describe("the plan gate holds through the real MCP tool handler", () => {
  it("refuses a domain on free with no entitlement flag at all", async () => {
    const { user, workspace } = await seedWorkspace();
    onPlan("free");
    const create = tools.get("create_resource")!;
    expect(create).toBeTruthy();
    const res = await create(
      { workspaceId: workspace.id, type: "stream", data: { name: "site", domains: ["mcp-blocked.example.com"] } },
      ctxFor(user)
    );
    expect(`${res?.isError} ${textOf(res)}`).toMatch(/Business and Enterprise|403/);
  });

  it("allows the same call on a plan that permits it", async () => {
    const { user, workspace } = await seedWorkspace();
    onPlan("business");
    const create = tools.get("create_resource")!;
    const res = await create(
      { workspaceId: workspace.id, type: "stream", data: { name: "site", domains: ["mcp-ok.example.com"] } },
      ctxFor(user)
    );
    expect(res?.isError).toBeFalsy();
  });

  it("refuses turning identity stitching on below enterprise", async () => {
    const { user, workspace } = await seedWorkspace();
    const prisma = deps().prisma;
    const stream = await prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "stream", config: { name: "s" } },
    });
    const dest = await prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "destination", config: { name: "d", destinationType: "webhook" } },
    });
    onPlan("business");
    const create = tools.get("create_resource")!;
    const res = await create(
      {
        workspaceId: workspace.id,
        type: "connection",
        data: {
          fromId: stream.id,
          toId: dest.id,
          type: "push",
          data: { functions: [{ functionId: IDENTITY_STITCHING_FUNCTION_ID }] },
        },
      },
      ctxFor(user)
    );
    expect(`${res?.isError} ${textOf(res)}`).toMatch(/Enterprise|403/);
  });
});
