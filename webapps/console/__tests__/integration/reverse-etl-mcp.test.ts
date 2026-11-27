import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import { seedPendingReverseRun } from "./support/reverse-pending";
import { registerTools } from "../../lib/server/mcp-server/tools";
import { ReverseEtlService } from "../../lib/server/reverse-etl-service";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { SyncService } from "../../lib/server/sync-service";
import { getServerEnv } from "../../lib/server/serverEnv";
import { readReverseSync } from "../../lib/server/reverse-sync-export";

const handlers = new Map<string, any>();
const annotations = new Map<string, any>();
const noop: any = new Proxy({}, { get: () => () => undefined });
beforeEach(() => {
  handlers.clear();
  annotations.clear();
  registerTools(
    {
      registerTool(name: string, config: any, cb: any) {
        handlers.set(name, cb);
        annotations.set(name, config.annotations);
      },
    } as any,
    {
      service: new ConfigObjectsService({ prisma: deps().prisma }),
      reverseEtl: new ReverseEtlService(deps().prisma),
      syncs: new SyncService(deps()),
      eventsLog: noop,
      debug: noop,
      reports: noop,
      auditLog: noop,
      req: { headers: { host: "console.test.local" }, socket: { remoteAddress: "127.0.0.1" } } as any,
    }
  );
});
const call = (name: string, user: { internalId: string; email: string }, args: any) =>
  handlers.get(name)(args, {
    authInfo: { extra: { userId: user.internalId, email: user.email } },
    signal: new AbortController().signal,
  });
const text = (result: any) => result.content.map((c: any) => c.text).join(" ");
const value = (result: any) => {
  expect(result.isError, text(result)).not.toBe(true);
  return JSON.parse(text(result));
};
async function fixture(role: "owner" | "analyst" = "owner") {
  const { user, workspace } = await seedWorkspace({ role });
  const { prisma } = deps();
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const warehouse = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: { destinationType: "postgres", host: "never-contact.test" },
    },
  });
  const model = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "model",
      config: { name: "Test", warehouseId: warehouse.id, query: "select email from people", primaryKey: ["email"] },
    },
  });
  const destination = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: { name: "Google", destinationType: "google-ads", secret: "must-not-leak" },
    },
  });
  const sync = {
    fromId: model.id,
    toId: destination.id,
    data: {
      version: 2,
      stream: "audience",
      mode: "mirror",
      mapping: { email: "email" },
      disabled: true,
      streamOptions: {
        audience: { kind: "managed", displayName: "Test" },
        exclusiveManagementConfirmed: true,
        customerMatchTermsAccepted: true,
      },
    },
  };
  const invoke = (name: string, args: any = {}) => call(name, user, { workspaceId: workspace.id, ...args });
  const create = async () => value(await invoke("create_reverse_sync", { requestId: randomUUID(), sync }));
  return { user, workspace, prisma, model, warehouse, destination, sync, invoke, create };
}

describe("Reverse ETL MCP", () => {
  it("creates idempotently, validates mappings, updates and deletes through the console guards", async () => {
    const f = await fixture();
    const requestId = randomUUID();
    const { id } = value(await f.invoke("create_reverse_sync", { requestId, sync: f.sync }));
    expect(value(await f.invoke("create_reverse_sync", { requestId, sync: f.sync }))).toEqual({ id });
    const invalid = await f.invoke("update_reverse_sync", {
      syncId: id,
      sync: { ...f.sync, data: { ...f.sync.data, mapping: {} } },
    });
    expect(invalid.isError).toBe(true);
    expect(text(invalid)).toMatch(/configure|required/i);
    value(await f.invoke("update_reverse_sync", { syncId: id, sync: { disabled: false } }));
    expect((await f.invoke("delete_reverse_sync", { syncId: id })).isError).toBe(true);
    const list = value(await f.invoke("list_reverse_syncs"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, fromId: f.model.id, toId: f.destination.id, options: { disabled: false } });
    expect(JSON.stringify(list)).not.toContain("must-not-leak");
    // Rollout flag removal still permits cleanup, but never new runs.
    await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
    expect((await f.invoke("run_reverse_sync", { syncId: id })).isError).toBe(true);
    value(await f.invoke("update_reverse_sync", { syncId: id, sync: { disabled: true } }));
    value(await f.invoke("delete_reverse_sync", { syncId: id }));
    expect(value(await f.invoke("list_reverse_syncs"))).toEqual([]);
    const audit = await f.prisma.auditLog.findMany({ where: { workspaceId: f.workspace.id } });
    expect(JSON.stringify(audit)).toContain("mcp");
  });

  it("previews model rows and inspects saved columns using the real PostgreSQL reader", async () => {
    const f = await fixture();
    const url = new URL(getServerEnv().DATABASE_URL);
    await f.prisma.configurationObject.update({
      where: { id: f.warehouse.id },
      data: {
        config: {
          destinationType: "postgres",
          host: url.hostname,
          port: Number(url.port),
          database: url.pathname.slice(1),
          username: url.username,
          password: url.password,
          sslMode: "disable",
        },
      },
    });
    const query = "SELECT 'person@example.com'::text AS email, jsonb_build_object('city', 'NY') AS traits";
    const result = value(
      await f.invoke("preview_model", { warehouseId: f.warehouse.id, query, nestedObjects: "leaveAsIs" })
    );
    expect(result.rows).toEqual([{ email: "person@example.com", traits: { city: "NY" } }]);
    await f.prisma.configurationObject.update({
      where: { id: f.model.id },
      data: {
        config: {
          warehouseId: f.warehouse.id,
          query,
          primaryKey: ["email"],
        },
      },
    });
    const columns = value(await f.invoke("get_model_columns", { modelId: f.model.id }));
    expect(columns.columns.map((c: any) => c.name)).toEqual(["email", "traits"]);
    expect(columns).not.toHaveProperty("rows");
    expect(
      (await f.invoke("preview_model", { warehouseId: f.warehouse.id, query: "DELETE FROM people" })).isError
    ).toBe(true);
  });

  it("enforces workspace and role permissions before querying warehouses or mutating syncs", async () => {
    const owner = await fixture();
    const analyst = await fixture("analyst");
    const { id } = await owner.create();
    expect(value(await analyst.invoke("list_reverse_syncs"))).toEqual([]);
    for (const [name, args] of [
      ["create_reverse_sync", { requestId: randomUUID(), sync: analyst.sync }],
      ["preview_model", { warehouseId: analyst.warehouse.id, query: "select 1" }],
      ["get_model_columns", { modelId: analyst.model.id }],
      ["run_reverse_sync", { syncId: id }],
      ["cancel_reverse_sync", { syncId: id, taskId: "foreign" }],
    ] as const) {
      const result = await analyst.invoke(name, args);
      expect(text(result)).toContain("403");
    }
    expect(text(await call("list_reverse_syncs", analyst.user, { workspaceId: owner.workspace.id }))).toContain("403");
    expect((await analyst.invoke("get_reverse_sync_logs", { syncId: id, taskId: "foreign" })).isError).toBe(true);
    expect(
      (await owner.invoke("update_reverse_sync", { syncId: id, sync: { ...owner.sync, fromId: analyst.model.id } }))
        .isError
    ).toBe(true);
  });

  it("dispatches runs, refreshes and cancellation with logical task IDs and preserves admission checks", async () => {
    const f = await fixture();
    const { id } = await f.create();
    const requests: URL[] = [];
    server.use(
      http.post("http://syncctl.test.local/read", ({ request }) => {
        const url = new URL(request.url);
        requests.push(url);
        return HttpResponse.json({ ok: true, taskId: url.searchParams.get("taskId") ?? "new-task" });
      }),
      http.get("http://syncctl.test.local/cancel", ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json({ ok: true });
      })
    );
    expect((await f.invoke("run_reverse_sync", { syncId: id })).isError).toBe(true);
    expect(requests).toHaveLength(0);
    value(await f.invoke("update_reverse_sync", { syncId: id, sync: { disabled: false } }));
    expect(value(await f.invoke("run_reverse_sync", { syncId: id }))).toEqual({
      status: "started",
      taskId: "new-task",
    });
    const config = (await readReverseSync(f.prisma, id, f.workspace.id))!;
    const { refreshTaskId: taskId } = await seedPendingReverseRun(f.prisma, id, f.workspace.id, config.configRevision);
    value(await f.invoke("run_reverse_sync", { syncId: id })); // Acceptance pending does not block extraction.
    await f.prisma.source_task.update({ where: { task_id: taskId }, data: { status: "RUNNING" } });
    const runningCount = requests.length;
    expect(text(await f.invoke("run_reverse_sync", { syncId: id }))).toContain("still extracting");
    expect(requests).toHaveLength(runningCount);
    await f.prisma.source_task.update({ where: { task_id: taskId }, data: { status: "PENDING" } });
    value(await f.invoke("update_reverse_sync", { syncId: id, sync: { disabled: true } }));
    expect(value(await f.invoke("refresh_reverse_sync", { syncId: id, taskId }))).toEqual({
      status: "status refresh requested",
      taskId,
    });
    for (const url of requests) {
      expect(url.searchParams.get("kind")).toBe("reverse");
      expect(url.searchParams.get("workspaceId")).toBe(f.workspace.id);
      expect(url.searchParams.get("syncId")).toBe(id);
    }
    expect(requests.at(-1)?.searchParams.get("taskId")).toBe(taskId);
    const savedModel = await f.prisma.configurationObject.findUniqueOrThrow({ where: { id: f.model.id } });
    await f.prisma.configurationObject.update({
      where: { id: f.model.id },
      data: { config: { ...(savedModel.config as object), query: "select email from changed_people" } },
    });
    const refreshCount = requests.length;
    expect(text(await f.invoke("refresh_reverse_sync", { syncId: id, taskId }))).toContain("configuration has changed");
    expect(requests).toHaveLength(refreshCount);
    expect((await f.invoke("delete_reverse_sync", { syncId: id })).isError).toBe(true);
    await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
    value(await f.invoke("cancel_reverse_sync", { syncId: id, taskId }));
    expect(requests.at(-1)?.pathname).toBe("/cancel");
    const count = requests.length;
    expect((await f.invoke("refresh_reverse_sync", { syncId: id, taskId })).isError).toBe(true);
    expect((await f.invoke("cancel_reverse_sync", { syncId: id, taskId: "foreign" })).isError).toBe(true);
    expect(requests).toHaveLength(count);
  });

  it("returns scoped tasks and diagnostic logs without raw recovery payloads", async () => {
    const f = await fixture();
    const { id } = await f.create();
    const { refreshTaskId: taskId } = await seedPendingReverseRun(f.prisma, id, f.workspace.id, "revision");
    await f.prisma.task_log.createMany({
      data: [
        { sync_id: id, task_id: taskId, logger: "retl-runner", level: "ERROR", message: "Status check failed" },
        { sync_id: id, task_id: taskId, logger: "private-provider", level: "INFO", message: "must-not-leak" },
      ],
    });
    const tasks = value(await f.invoke("list_reverse_sync_tasks", { syncId: id, status: "PENDING" }));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ task_id: taskId, latestLogLevel: "ERROR", canRefresh: true });
    expect(tasks[0]).not.toHaveProperty("metrics");
    const logs = value(await f.invoke("get_reverse_sync_logs", { syncId: id, taskId }));
    expect(logs.map((l: any) => l.message)).toEqual(["Status check failed"]);
    const other = await fixture();
    expect(value(await other.invoke("list_reverse_sync_tasks", { syncId: id }))).toEqual([]);
    expect((await other.invoke("get_reverse_sync_logs", { syncId: id, taskId })).isError).toBe(true);
    const generic = value(await f.invoke("list_sync_tasks", { syncId: id }));
    expect(generic.ok).toBe(true);
    expect(generic.tasks.map((t: any) => t.task_id)).toEqual([taskId]);
  });

  it("blocks every non-read-only RETL tool in maintenance without invoking its handler", async () => {
    const f = await fixture();
    vi.stubEnv("JITSU_CONSOLE_READ_ONLY", "true");
    for (const name of [
      "create_reverse_sync",
      "update_reverse_sync",
      "delete_reverse_sync",
      "run_reverse_sync",
      "refresh_reverse_sync",
      "cancel_reverse_sync",
      "preview_model",
      "get_model_columns",
    ]) {
      expect(annotations.get(name).readOnlyHint).toBe(false);
      expect(text(await f.invoke(name))).toContain("read-only");
    }
    expect(value(await f.invoke("list_reverse_syncs"))).toEqual([]);
  });
});
