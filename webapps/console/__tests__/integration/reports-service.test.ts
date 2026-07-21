import { describe, expect, it } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { ReportsService } from "../../lib/server/reports-service";

// Happy paths: syncStat's source_task ⋈ ConfigurationObjectLink join on real
// Postgres, and eventStat's sumMerge aggregation through the real
// metrics → to_mv_metrics → mv_metrics materialized-view chain in ClickHouse.

const svc = () => new ReportsService({ prisma: deps().prisma, pgPool: deps().pgPool, clickhouse: deps().clickhouse });

async function seedSync(workspaceId: string) {
  const prisma = deps().prisma;
  const service = await prisma.configurationObject.create({
    data: { workspaceId, type: "service", config: { name: "src", package: "p", version: "1" } },
  });
  const destination = await prisma.configurationObject.create({
    data: { workspaceId, type: "destination", config: { name: "wh", destinationType: "webhook" } },
  });
  return prisma.configurationObjectLink.create({
    data: { workspaceId, fromId: service.id, toId: destination.id, type: "sync" },
  });
}

describe("ReportsService", () => {
  it("syncStat counts distinct syncs with a successful task in the period", async () => {
    const { user, workspace } = await seedWorkspace();
    const sync = await seedSync(workspace.id);
    const { workspace: foreign } = await seedWorkspace();
    const foreignSync = await seedSync(foreign.id);

    const mkTask = (syncId: string, taskId: string, status: string, startedAt: string) => ({
      sync_id: syncId,
      task_id: taskId,
      package: "p",
      version: "1",
      status,
      started_at: new Date(startedAt),
    });
    await deps().prisma.source_task.createMany({
      data: [
        mkTask(sync.id, "t1", "SUCCESS", "2026-06-10T10:00:00Z"),
        mkTask(sync.id, "t2", "SUCCESS", "2026-06-11T10:00:00Z"), // same pair — distinct keeps it at 1
        mkTask(sync.id, "t3", "FAILED", "2026-06-12T10:00:00Z"),
        mkTask(sync.id, "t4", "SUCCESS", "2026-01-01T10:00:00Z"), // outside the period
        mkTask(foreignSync.id, "t5", "SUCCESS", "2026-06-10T10:00:00Z"), // other workspace
      ],
    });

    const res = await svc().syncStat(user, workspace.id, {
      start: "2026-06-01T00:00:00Z",
      end: "2026-07-01T00:00:00Z",
    });
    expect(Number(res.activeSyncs)).toBe(1);
  });

  it("eventStat aggregates events through the mv_metrics materialized view", async () => {
    const { user, workspace } = await seedWorkspace();
    const { workspace: foreign } = await seedWorkspace();

    // Insert into the Null `metrics` table — rows materialize into mv_metrics
    // through the to_mv_metrics MV, the same path prod uses.
    const row = (messageId: string, over: Partial<Record<string, any>>) => ({
      messageId,
      workspaceId: workspace.id,
      streamId: "s1",
      connectionId: "c1",
      functionId: "",
      destinationId: "d1",
      status: "success",
      eventIndex: 0,
      ...over,
    });
    await deps().clickhouse.insert({
      table: "metrics",
      format: "JSONEachRow",
      clickhouse_settings: { wait_end_of_query: 1 },
      values: [
        // two rows, same connection/status/minute → one aggregated row with the summed count
        row("m1", { timestamp: "2026-06-10 10:00:05", events: 5 }),
        row("m2", { timestamp: "2026-06-10 10:00:30", events: 7 }),
        row("m3", { timestamp: "2026-06-10 11:00:00", status: "error", events: 1 }),
        row("m4", {
          timestamp: "2026-06-10 10:00:00",
          workspaceId: foreign.id,
          streamId: "s9",
          connectionId: "c9",
          destinationId: "d9",
          events: 100,
        }),
      ],
    });

    const res = await svc().eventStat(user, workspace.id, {
      start: "2026-06-10T00:00:00Z",
      end: "2026-06-11T00:00:00Z",
      granularity: "day",
    });
    expect(res.granularity).toBe("day");
    expect(res.rows).toHaveLength(2); // success + error for the day; the foreign row is absent
    const byStatus = Object.fromEntries(res.rows.map((r: any) => [r.status, r]));
    expect(Number(byStatus.success.events)).toBe(12); // 5 + 7 via sumMerge
    expect(Number(byStatus.error.events)).toBe(1);
    // srcSize (underlying chunk count) is part of the wire shape the UI's Report schema requires
    expect(Number(byStatus.success.srcSize)).toBeGreaterThan(0);
    expect(byStatus.success.period).toBe("2026-06-10T00:00:00Z");
    expect(byStatus.success.workspaceId).toBe(workspace.id);
  });
});
