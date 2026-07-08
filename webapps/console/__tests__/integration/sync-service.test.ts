import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./support/msw";
import { deps, seedWorkspace } from "./support/harness";
import { SyncService } from "../../lib/server/sync-service";

// Happy paths against real Postgres (source_task join, source_state, task_log
// fallback), real ClickHouse (task_log), and MSW-faked syncctl.

const svc = () => new SyncService({ prisma: deps().prisma, pgPool: deps().pgPool, clickhouse: deps().clickhouse });

async function seedSync(workspaceId: string) {
  const prisma = deps().prisma;
  const service = await prisma.configurationObject.create({
    data: {
      workspaceId,
      type: "service",
      config: {
        name: "github source",
        package: "airbyte/source-github",
        version: "1.0.0",
        credentials: { token: "secret" },
      },
    },
  });
  const destination = await prisma.configurationObject.create({
    data: { workspaceId, type: "destination", config: { name: "wh", destinationType: "webhook" } },
  });
  return prisma.configurationObjectLink.create({
    data: { workspaceId, fromId: service.id, toId: destination.id, type: "sync", data: {} },
  });
}

describe("SyncService", () => {
  it("runSync posts to syncctl and records a RUNNING source_task through the prisma singleton", async () => {
    const { user, workspace } = await seedWorkspace();
    const sync = await seedSync(workspace.id);

    let syncctlQuery: URLSearchParams | undefined;
    server.use(
      http.post("http://syncctl.test.local/read", ({ request }) => {
        syncctlQuery = new URL(request.url).searchParams;
        return HttpResponse.json({ ok: true });
      })
    );

    const req = { headers: { host: "console.test.local" } } as any;
    const res = await svc().runSync(user, workspace.id, { syncId: sync.id }, req);
    expect(res.ok).toBe(true);
    expect(res.taskId).toBeTruthy();
    expect(syncctlQuery?.get("syncId")).toBe(sync.id);
    expect(syncctlQuery?.get("fullSync")).toBe("false");

    // scheduleSync wrote the task via the db.prisma() singleton — same database
    const task = await deps().prisma.source_task.findUniqueOrThrow({ where: { task_id: res.taskId! } });
    expect(task).toMatchObject({ sync_id: sync.id, status: "RUNNING", package: "airbyte/source-github" });

    // a second manual run is rejected while the task row is RUNNING
    const again = await svc().runSync(user, workspace.id, { syncId: sync.id }, req);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already running/);
  });

  it("listSyncTasks joins source_task to the workspace's syncs only", async () => {
    const { user, workspace } = await seedWorkspace();
    const sync = await seedSync(workspace.id);
    const { workspace: foreign } = await seedWorkspace();
    const foreignSync = await seedSync(foreign.id);

    const prisma = deps().prisma;
    await prisma.source_task.createMany({
      data: [
        {
          sync_id: sync.id,
          task_id: "task-ok",
          package: "airbyte/source-github",
          version: "1.0.0",
          status: "SUCCESS",
          started_at: new Date("2026-07-01T10:00:00Z"),
        },
        {
          sync_id: sync.id,
          task_id: "task-running",
          package: "airbyte/source-github",
          version: "1.0.0",
          status: "RUNNING",
          started_at: new Date("2026-07-01T11:00:00Z"),
        },
        {
          sync_id: foreignSync.id,
          task_id: "task-foreign",
          package: "airbyte/source-github",
          version: "1.0.0",
          status: "SUCCESS",
          started_at: new Date("2026-07-01T12:00:00Z"),
        },
      ],
    });

    const all = await svc().listSyncTasks(user, workspace.id, {});
    expect(all.ok).toBe(true);
    expect(all.tasks.map((t: any) => t.task_id).sort()).toEqual(["task-ok", "task-running"]);

    const filtered = await svc().listSyncTasks(user, workspace.id, { status: "RUNNING" });
    expect(filtered.tasks.map((t: any) => t.task_id)).toEqual(["task-running"]);

    const byId = await svc().listSyncTasks(user, workspace.id, { taskId: "task-ok" });
    expect(byId.ok).toBe(true);
    expect(byId.task.task_id).toBe("task-ok");

    // a foreign task id doesn't resolve through this workspace's join
    const foreignById = await svc().listSyncTasks(user, workspace.id, { taskId: "task-foreign" });
    expect(foreignById.ok).toBe(false);
  });

  it("getSyncState reads and resetSyncState deletes source_state rows", async () => {
    const { user, workspace } = await seedWorkspace();
    const sync = await seedSync(workspace.id);
    const prisma = deps().prisma;
    await prisma.source_state.createMany({
      data: [
        { sync_id: sync.id, stream: "issues", state: { cursor: "2026-07-01" } },
        { sync_id: sync.id, stream: "pulls", state: { cursor: "2026-06-15" } },
      ],
    });

    const state = await svc().getSyncState(user, workspace.id, sync.id);
    expect(state.ok).toBe(true);
    expect(Object.keys(state.state).sort()).toEqual(["issues", "pulls"]);
    expect(JSON.parse(state.state.issues)).toEqual({ cursor: "2026-07-01" });

    // reset one stream
    const afterStream = await svc().resetSyncState(user, workspace.id, { syncId: sync.id, stream: "issues" });
    expect(afterStream.ok).toBe(true);
    expect(Object.keys(afterStream.state)).toEqual(["pulls"]);

    // reset the rest
    const afterAll = await svc().resetSyncState(user, workspace.id, { syncId: sync.id });
    expect(afterAll.state).toEqual({});
    expect(await prisma.source_state.count({ where: { sync_id: sync.id } })).toBe(0);
  });

  it("getSyncLogs reads ClickHouse task_log and falls back to the Postgres copy", async () => {
    const { user, workspace } = await seedWorkspace();
    const sync = await seedSync(workspace.id);

    // ClickHouse path
    await deps().clickhouse.insert({
      table: "task_log",
      format: "JSONEachRow",
      clickhouse_settings: { wait_end_of_query: 1 },
      values: [
        {
          task_id: "task-ch",
          sync_id: sync.id,
          timestamp: "2026-07-01 10:00:00.000",
          level: "INFO",
          logger: "sync",
          message: "started",
        },
        {
          task_id: "task-ch",
          sync_id: sync.id,
          timestamp: "2026-07-01 10:01:00.000",
          level: "INFO",
          logger: "sync",
          message: "finished",
        },
      ],
    });
    const chLogs = await svc().getSyncLogs(user, workspace.id, { syncId: sync.id, taskId: "task-ch" });
    expect(chLogs.ok).toBe(true);
    expect(chLogs.logs.map((l: any) => l.message)).toEqual(["finished", "started"]); // newest first

    // Postgres fallback: nothing in ClickHouse for this task
    await deps().prisma.task_log.create({
      data: {
        task_id: "task-pg",
        sync_id: sync.id,
        level: "INFO",
        logger: "sync",
        message: "from postgres",
        timestamp: new Date("2026-07-01T10:00:00Z"),
      },
    });
    const pgLogs = await svc().getSyncLogs(user, workspace.id, { syncId: sync.id, taskId: "task-pg" });
    expect(pgLogs.ok).toBe(true);
    expect(pgLogs.logs.map((l: any) => l.message)).toEqual(["from postgres"]);
  });
});
