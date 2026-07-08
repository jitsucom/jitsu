import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./support/msw";
import { deps, seedWorkspace } from "./support/harness";
import { DebugService } from "../../lib/server/debug-service";

// Happy paths: the stored function's draft code is loaded from real Postgres
// and dispatched to the functions server (MSW at the baseline
// FUNCTIONS_SERVER_URL_TEMPLATE with ${workspaceId} → deploymentId).

const svc = () => new DebugService({ prisma: deps().prisma });

describe("DebugService", () => {
  it("runFunction posts the stored draft to the workspace's functions server", async () => {
    const { user, workspace } = await seedWorkspace();
    const fn = await deps().prisma.configurationObject.create({
      data: {
        workspaceId: workspace.id,
        type: "function",
        config: {
          name: "enrich",
          code: "export default async () => 'deployed'",
          draft: "export default async () => 'draft'",
        },
      },
    });
    await deps().prisma.functionsServer.create({
      data: {
        workspaceId: workspace.id,
        class: "free",
        deploymentId: "dep1",
        connections: [],
        emptyConnections: [],
        profileBuilders: [],
      },
    });

    let posted: any;
    const runResult = { result: "ok", store: {}, logs: [{ level: "info", message: "ran" }] };
    server.use(
      http.post("http://fs-dep1.test.local/udfrun", async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(runResult);
      })
    );

    const res = await svc().runFunction(user, workspace.id, {
      functionId: fn.id,
      event: { type: "track", event: "signup" },
    });
    expect(res).toEqual(runResult); // handler response returned verbatim
    // the DRAFT was posted (falls back to code only when there is no draft)
    expect(posted.code).toBe("export default async () => 'draft'");
    expect(posted.functionId).toBe(fn.id);
    expect(posted.workspaceId).toBe(workspace.id);
    expect(posted.event).toEqual({ type: "track", event: "signup" });
  });

  it("runFunction reports FunctionRuntimeNotReady when the workspace has no functions server", async () => {
    const { user, workspace } = await seedWorkspace();
    const fn = await deps().prisma.configurationObject.create({
      data: {
        workspaceId: workspace.id,
        type: "function",
        config: { name: "enrich", code: "export default async () => 1" },
      },
    });
    const res = await svc().runFunction(user, workspace.id, { functionId: fn.id, event: {} });
    expect(res.error?.name).toBe("FunctionRuntimeNotReady");
  });
});
