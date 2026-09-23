import { describe, it, expect } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { exportReverseSyncs, readReverseSync } from "../../lib/server/reverse-sync-export";
import { seedPendingReverseRun } from "./support/reverse-pending";

async function seed() {
  const { workspace } = await seedWorkspace();
  const prisma = deps().prisma;
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const warehouse = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: { destinationType: "postgres", host: "localhost", password: "private", authenticationMethod: "password" },
    },
  });
  const model = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "model",
      config: { warehouseId: warehouse.id, query: "SELECT id FROM users", primaryKey: ["id"] },
    },
  });
  const destination = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: { destinationType: "google-ads", token: "private" },
    },
  });
  const options = { version: 2, stream: "audience", mode: "upsert", mapping: { email: "id" }, schedule: "0 * * * *" };
  const link = await prisma.configurationObjectLink.create({
    data: { workspaceId: workspace.id, type: "reverse-sync", fromId: model.id, toId: destination.id, data: options },
  });
  return { workspace, warehouse, model, destination, options, link, prisma };
}
describe("reverse sync export/admission", () => {
  it("exports paused pending delivery without a schedule and admits only its saved task", async () => {
    const f = await seed();
    const initial = (await readReverseSync(f.prisma, f.link.id))!;
    const admission = await seedPendingReverseRun(f.prisma, f.link.id, f.workspace.id, initial.configRevision);
    await f.prisma.configurationObjectLink.update({
      where: { id: f.link.id },
      data: { data: { ...f.options, disabled: true } },
    });
    expect(await readReverseSync(f.prisma, f.link.id)).toBeUndefined();
    const resumed = await readReverseSync(f.prisma, f.link.id, f.workspace.id, admission);
    expect(resumed?.configRevision).toBe(initial.configRevision);
    expect(resumed?.options.disabled).toBe(true);
    expect(resumed?.schedule).toBeUndefined();
    await f.prisma.source_task.update({ where: { task_id: admission.refreshTaskId }, data: { status: "CANCELLED" } });
    expect(await readReverseSync(f.prisma, f.link.id, f.workspace.id, admission)).toEqual(resumed);
    expect(await readReverseSync(f.prisma, f.link.id, f.workspace.id, { refreshTaskId: "missing" })).toBeUndefined();
    expect(await readReverseSync(f.prisma, f.link.id, "foreign", admission)).toBeUndefined();
    let output = "";
    await exportReverseSyncs(f.prisma, {
      write: text => {
        output += text;
      },
    });
    expect(JSON.parse(output).find((row: any) => row.id === f.link.id)).toMatchObject({ options: { disabled: true } });
    expect(JSON.parse(output).find((row: any) => row.id === f.link.id).schedule).toBeUndefined();
    await f.prisma.reverse_sync_control.updateMany({ where: { sync_id: f.link.id }, data: { phase: "complete" } });
    expect(await readReverseSync(f.prisma, f.link.id, f.workspace.id, admission)).toBeUndefined();
    expect(await readReverseSync(f.prisma, f.link.id, undefined, { exportPending: true })).toBeUndefined();
  });
  it.each(["revision", "flag", "deleted", "task-workspace", "task-revision", "complete"])(
    "rejects paused refresh with invalid %s",
    async reason => {
      const f = await seed();
      const initial = (await readReverseSync(f.prisma, f.link.id))!;
      const admission = await seedPendingReverseRun(f.prisma, f.link.id, f.workspace.id, initial.configRevision);
      await f.prisma.configurationObjectLink.update({
        where: { id: f.link.id },
        data: { data: { ...f.options, disabled: true } },
      });
      if (reason === "revision")
        await f.prisma.reverse_sync_control.updateMany({
          where: { sync_id: f.link.id },
          data: { revision: "b".repeat(64) },
        });
      if (reason === "flag")
        await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
      if (reason === "deleted")
        await f.prisma.configurationObjectLink.update({ where: { id: f.link.id }, data: { deleted: true } });
      if (reason === "task-workspace")
        await f.prisma.source_task.update({
          where: { task_id: admission.refreshTaskId },
          data: { started_by: { workspaceId: "foreign" } },
        });
      if (reason === "task-revision")
        await f.prisma.source_task.update({
          where: { task_id: admission.refreshTaskId },
          data: { metrics: { reverseRecovery: { runId: "foreign", revision: "b".repeat(64) } } },
        });
      if (reason === "complete")
        await f.prisma.source_task.update({
          where: { task_id: admission.refreshTaskId },
          data: { status: "COMPLETE" },
        });
      expect(await readReverseSync(f.prisma, f.link.id, f.workspace.id, admission)).toBeUndefined();
    }
  );
  it("emits a self-contained runtime config with revision and scoped credentials", async () => {
    const f = await seed();
    const result = await readReverseSync(f.prisma, f.link.id, f.workspace.id);
    expect(result).toMatchObject({
      kind: "reverse",
      id: f.link.id,
      workspaceId: f.workspace.id,
      schedule: "0 * * * *",
      warehouse: { password: "private" },
    });
    expect(result?.configRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(await readReverseSync(f.prisma, f.link.id, "another-workspace")).toBeUndefined();
  });
  it("excludes disabled/deleted and flag-disabled syncs at admission", async () => {
    const f = await seed();
    await f.prisma.configurationObjectLink.update({
      where: { id: f.link.id },
      data: { data: { ...f.options, disabled: true } },
    });
    expect(await readReverseSync(f.prisma, f.link.id)).toBeUndefined();
    await f.prisma.configurationObjectLink.update({ where: { id: f.link.id }, data: { data: f.options } });
    await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
    expect(await readReverseSync(f.prisma, f.link.id)).toBeUndefined();
  });
  it("changes delivery revision for model/config changes, not scheduling changes", async () => {
    const f = await seed();
    const initial = (await readReverseSync(f.prisma, f.link.id))!;
    await f.prisma.configurationObjectLink.update({
      where: { id: f.link.id },
      data: { data: { ...f.options, schedule: "0 0 * * *", checkpointEvery: 100 } },
    });
    expect((await readReverseSync(f.prisma, f.link.id))?.configRevision).toBe(initial.configRevision);
    await f.prisma.configurationObject.update({
      where: { id: f.model.id },
      data: { config: { warehouseId: f.warehouse.id, query: "SELECT id FROM other_users", primaryKey: ["id"] } },
    });
    expect((await readReverseSync(f.prisma, f.link.id))?.configRevision).not.toBe(initial.configRevision);
  });
  it("fails the entire feed for corrupt active configuration instead of omitting it", async () => {
    const f = await seed();
    await f.prisma.configurationObjectLink.update({ where: { id: f.link.id }, data: { data: { mode: "garbage" } } });
    let output = "";
    await expect(
      exportReverseSyncs(f.prisma, {
        write: text => {
          output += text;
        },
      })
    ).rejects.toThrow();
    expect(() => JSON.parse(output)).toThrow();
    // Remove the invalid fixture so other tests sharing this file's database can export.
    await f.prisma.configurationObjectLink.update({ where: { id: f.link.id }, data: { deleted: true } });
  });
  it("rejects foreign warehouse references and tombstone mirror models", async () => {
    const f = await seed(),
      other = await seed();
    await f.prisma.configurationObject.update({
      where: { id: f.model.id },
      data: { config: { warehouseId: other.warehouse.id, query: "SELECT id FROM users", primaryKey: ["id"] } },
    });
    await expect(readReverseSync(f.prisma, f.link.id)).rejects.toThrow();
    await f.prisma.configurationObject.update({
      where: { id: f.model.id },
      data: {
        config: {
          warehouseId: f.warehouse.id,
          query: "SELECT id,deleted FROM users",
          primaryKey: ["id"],
          deleteColumn: "deleted",
        },
      },
    });
    await f.prisma.configurationObjectLink.update({
      where: { id: f.link.id },
      data: { data: { ...f.options, mode: "mirror" } },
    });
    await expect(readReverseSync(f.prisma, f.link.id)).rejects.toThrow();
  });
});
