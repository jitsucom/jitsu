import type { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { exportReverseSyncs, readReverseSync } from "../../lib/server/reverse-sync-export";
import { webhookRetentionRefusal, WEBHOOK_RETENTION_ZERO_MESSAGE } from "../../lib/server/reverse-retention";
import { seedPendingReverseRun } from "./support/reverse-pending";

// Retention of the stored rows of a webhook sync (JITSU-242, WP7). The run configuration names the retention bucket
// for webhook syncs only; a new run is refused when the workspace's storage duration is 0; the export never refuses.
afterEach(() => vi.unstubAllEnvs());
const withEe = () => vi.stubEnv("EE_CONNECTION", "https://billing.example.com/");

async function seed(destinationConfig: Prisma.InputJsonObject, options: Prisma.InputJsonObject) {
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
    data: { workspaceId: workspace.id, type: "destination", config: destinationConfig },
  });
  const link = await prisma.configurationObjectLink.create({
    data: { workspaceId: workspace.id, type: "reverse-sync", fromId: model.id, toId: destination.id, data: options },
  });
  return { workspace, link, prisma, options };
}
const webhook = () =>
  seed(
    { destinationType: "webhook", name: "hook", url: "https://example.com/hook", method: "POST" },
    {
      version: 2,
      stream: "rows",
      mode: "upsert",
      mapping: { id: "id" },
      streamOptions: {},
      schedule: "0 * * * *",
      timezone: "Etc/UTC",
      disabled: false,
    }
  );
const google = () =>
  seed(
    { destinationType: "google-ads", token: "private" },
    { version: 2, stream: "audience", mode: "upsert", mapping: { email: "id" }, schedule: "0 * * * *" }
  );
const setRetention = (prisma: any, workspaceId: string, value: unknown) =>
  prisma.workspaceOptions.create({ data: { workspaceId, namespace: "data-retention", value } });

describe("webhook retention in the run configuration", () => {
  it("names the workspace's retention bucket for a webhook sync", async () => {
    withEe();
    const f = await webhook();
    const config = await readReverseSync(f.prisma, f.link.id, f.workspace.id);
    expect(config?.retention).toEqual({ bucket: `jitsu-retl-${f.workspace.id}` });
  });

  it("does not touch a Google sync: no retention field at all", async () => {
    withEe();
    const f = await google();
    const config = await readReverseSync(f.prisma, f.link.id, f.workspace.id);
    expect(config).toBeDefined();
    expect(Object.keys(config!)).not.toContain("retention");
  });

  it("leaves the revision hash alone: the same webhook sync has the same revision with and without retention", async () => {
    const f = await webhook();
    const without = await readReverseSync(f.prisma, f.link.id, f.workspace.id); // no EE: no retention field
    withEe();
    const withRetention = await readReverseSync(f.prisma, f.link.id, f.workspace.id);
    expect(without?.retention).toBeUndefined();
    expect(withRetention?.retention).toBeDefined();
    expect(withRetention?.configRevision).toBe(without?.configRevision);
  });

  it("self-hosted (no ee-api): nothing creates the bucket, so none is named", async () => {
    const f = await webhook();
    expect((await readReverseSync(f.prisma, f.link.id, f.workspace.id))?.retention).toBeUndefined();
  });

  it("is in the desired-state export for webhook syncs only", async () => {
    withEe();
    const hook = await webhook();
    const other = await google();
    let output = "";
    await exportReverseSyncs(hook.prisma, {
      write: text => {
        output += text;
      },
    });
    const rows = JSON.parse(output);
    expect(rows.find((row: any) => row.id === hook.link.id)?.retention).toEqual({
      bucket: `jitsu-retl-${hook.workspace.id}`,
    });
    expect(rows.find((row: any) => row.id === other.link.id)).not.toHaveProperty("retention");
  });
});

describe("storage duration 0 refuses new webhook runs", () => {
  it("refuses a new run with the readable message, for a webhook sync", async () => {
    withEe();
    const f = await webhook();
    await setRetention(f.prisma, f.workspace.id, { backupRetentionHours: 0 });
    await expect(readReverseSync(f.prisma, f.link.id, f.workspace.id)).rejects.toMatchObject({
      message: WEBHOOK_RETENTION_ZERO_MESSAGE,
      status: 409,
    });
  });

  it("the nobackup flag is the same as 0 days, and an explicit setting wins over it", async () => {
    withEe();
    const f = await webhook();
    await f.prisma.workspace.update({
      where: { id: f.workspace.id },
      data: { featuresEnabled: ["reverse-etl", "nobackup"] },
    });
    await expect(readReverseSync(f.prisma, f.link.id, f.workspace.id)).rejects.toThrow(/0 days/);
    await setRetention(f.prisma, f.workspace.id, { backupRetentionHours: 168 });
    expect((await readReverseSync(f.prisma, f.link.id, f.workspace.id))?.retention).toBeDefined();
  });

  it("7 days or more, and the unset default, are admitted", async () => {
    withEe();
    const f = await webhook();
    expect(await readReverseSync(f.prisma, f.link.id, f.workspace.id)).toBeDefined(); // default 90 days
    await setRetention(f.prisma, f.workspace.id, { backupRetentionHours: 168 });
    expect(await readReverseSync(f.prisma, f.link.id, f.workspace.id)).toBeDefined();
  });

  it("does not refuse a Google sync, whatever the retention", async () => {
    withEe();
    const f = await google();
    await setRetention(f.prisma, f.workspace.id, { backupRetentionHours: 0 });
    expect(await readReverseSync(f.prisma, f.link.id, f.workspace.id)).toBeDefined();
  });

  it("never refuses the desired-state export, so one workspace cannot break every sync's export", async () => {
    withEe();
    const f = await webhook();
    await setRetention(f.prisma, f.workspace.id, { backupRetentionHours: 0 });
    let output = "";
    await exportReverseSyncs(f.prisma, {
      write: text => {
        output += text;
      },
    });
    expect(JSON.parse(output).find((row: any) => row.id === f.link.id)).toBeDefined();
    // the paused/pending export path is the same call
    expect(await readReverseSync(f.prisma, f.link.id, undefined, { exportPending: true })).toBeDefined();
  });

  it("exports a retention-0 webhook sync without a schedule, so its CronJob stops starting runs", async () => {
    withEe();
    const f = await webhook(); // scheduled "0 * * * *"
    const exported = async () => {
      let output = "";
      await exportReverseSyncs(f.prisma, {
        write: text => {
          output += text;
        },
      });
      return JSON.parse(output).find((row: any) => row.id === f.link.id);
    };
    expect((await exported()).schedule).toBe("0 * * * *");
    await setRetention(f.prisma, f.workspace.id, { backupRetentionHours: 0 });
    const row = await exported();
    expect(row).toBeDefined(); // still exported: saved work can be recovered and refreshed
    expect(row.schedule).toBeUndefined();
    // the revision is unchanged by the schedule, so nothing about saved state is disturbed
    await f.prisma.workspaceOptions.deleteMany({ where: { workspaceId: f.workspace.id } });
    expect((await exported()).configRevision).toBe(row.configRevision);
  });

  it("a Google sync keeps its schedule whatever the retention", async () => {
    withEe();
    const f = await google();
    await setRetention(f.prisma, f.workspace.id, { backupRetentionHours: 0 });
    expect((await readReverseSync(f.prisma, f.link.id, f.workspace.id, { exportPending: true }))?.schedule).toBe(
      "0 * * * *"
    );
  });

  it("does not refuse recovery of a saved run (refresh)", async () => {
    withEe();
    const f = await webhook();
    const initial = (await readReverseSync(f.prisma, f.link.id))!;
    const admission = await seedPendingReverseRun(f.prisma, f.link.id, f.workspace.id, initial.configRevision);
    await setRetention(f.prisma, f.workspace.id, { backupRetentionHours: 0 });
    expect(await readReverseSync(f.prisma, f.link.id, f.workspace.id, admission)).toBeDefined();
  });

  it("webhookRetentionRefusal: none without ee-api or for a non-webhook destination", async () => {
    const f = await webhook();
    await setRetention(f.prisma, f.workspace.id, { backupRetentionHours: 0 });
    expect(
      await webhookRetentionRefusal(f.prisma, f.workspace.id, ["reverse-etl"], { destinationType: "webhook" })
    ).toBe(undefined);
    withEe();
    expect(
      await webhookRetentionRefusal(f.prisma, f.workspace.id, ["reverse-etl"], { destinationType: "google-ads" })
    ).toBe(undefined);
    expect(
      await webhookRetentionRefusal(f.prisma, f.workspace.id, ["reverse-etl"], { destinationType: "webhook" })
    ).toBe(WEBHOOK_RETENTION_ZERO_MESSAGE);
  });
});
