import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import {
  createReverseSync,
  updateReverseSync,
  deleteReverseSync,
  listReverseSyncs,
  reverseTasks,
  reverseLogs,
} from "../../lib/server/reverse-syncs";
import { readReverseSync } from "../../lib/server/reverse-sync-export";

async function fixture() {
  const { workspace, user } = await seedWorkspace();
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
      config: {
        name: "Audience",
        warehouseId: warehouse.id,
        query: "select email from unavailable_table",
        primaryKey: ["email"],
      },
    },
  });
  const destination = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "destination", config: { name: "Google", destinationType: "google-ads" } },
  });
  const input = {
    fromId: model.id,
    toId: destination.id,
    data: {
      version: 2,
      name: "Test",
      stream: "audience",
      mode: "mirror",
      mapping: { email: "email" },
      streamOptions: {
        audience: { kind: "managed", displayName: "Test" },
        exclusiveManagementConfirmed: true,
        customerMatchTermsAccepted: true,
      },
      schedule: "",
      timezone: "Etc/UTC",
      disabled: true,
    },
  };
  return {
    prisma,
    workspace,
    user,
    model,
    destination,
    warehouse,
    input,
    create: (raw: unknown = input, key = randomUUID()) => createReverseSync(prisma, workspace.id, key, raw),
  };
}
describe("single-save Reverse ETL settings", () => {
  it("saves all intent on one link without preview, OAuth, provisioning or auxiliary entities", async () => {
    const f = await fixture();
    const { id } = await f.create();
    const link = await f.prisma.configurationObjectLink.findUniqueOrThrow({ where: { id } });
    expect(link.data).toMatchObject(f.input.data);
    expect(
      await f.prisma.configurationObject.count({
        where: { workspaceId: f.workspace.id, type: { in: ["reverse-sync-setup", "reverse-google-audience"] } },
      })
    ).toBe(0);
    expect(await f.prisma.source_state.count({ where: { sync_id: id } })).toBe(0);
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false });
    expect((await readReverseSync(f.prisma, id))?.options.streamOptions).toMatchObject(f.input.data.streamOptions);
    expect((await listReverseSyncs(f.prisma, f.workspace.id))[0]).toMatchObject({ settingsLocked: false });
  });
  it.each(["managed", "existing"])("saves full replacement for %s audiences", async kind => {
    const f = await fixture();
    const { id } = await f.create({
      ...f.input,
      data: {
        ...f.input.data,
        streamOptions: {
          ...f.input.data.streamOptions,
          audience: kind === "managed" ? { kind, displayName: "Test" } : { kind, audienceId: "123" },
          mirrorStrategy: "full-replace",
        },
      },
    });
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false });
    expect((await readReverseSync(f.prisma, id))?.options.mode).toBe("mirror");
  });
  it("deduplicates a lost save response directly on the link", async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = await f.create(f.input, key);
    expect(await f.create(f.input, key)).toEqual(first);
    await expect(f.create({ ...f.input, data: { ...f.input.data, name: "changed" } }, key)).rejects.toThrow(
      "already created"
    );
    expect(
      await f.prisma.configurationObjectLink.count({ where: { workspaceId: f.workspace.id, type: "reverse-sync" } })
    ).toBe(1);
  });
  it("allows complete settings edits before first run", async () => {
    const f = await fixture();
    const { id } = await f.create();
    await updateReverseSync(f.prisma, f.workspace.id, id, {
      ...f.input,
      data: { ...f.input.data, mapping: { email: "other" } },
    });
    expect((await f.prisma.configurationObjectLink.findUniqueOrThrow({ where: { id } })).data).toMatchObject({
      mapping: { email: "other" },
    });
  });
  it("locks delivery edits once provisioning or a run has started, but allows scheduling", async () => {
    const f = await fixture();
    const { id } = await f.create();
    await f.prisma.source_state.create({
      data: { sync_id: id, stream: "_REVERSE_ETL_GOOGLE_AUDIENCE_", state: { phase: "submitting" } },
    });
    await expect(
      updateReverseSync(f.prisma, f.workspace.id, id, {
        ...f.input,
        data: { ...f.input.data, mapping: { email: "other" } },
      })
    ).rejects.toThrow("locked");
    await updateReverseSync(f.prisma, f.workspace.id, id, { schedule: "0 0 * * *", timezone: "UTC" });
    expect((await listReverseSyncs(f.prisma, f.workspace.id))[0].settingsLocked).toBe(true);
  });
  it.each(["cursor", "deleteColumn"])(
    "rejects unsafe mirror model %s structurally without querying it",
    async field => {
      const f = await fixture();
      await f.prisma.configurationObject.update({
        where: { id: f.model.id },
        data: {
          config: {
            ...(f.model.config as object),
            [field]: field === "cursor" ? { column: "email", type: "string" } : "deleted",
          },
        },
      });
      await expect(f.create()).rejects.toThrow("full-query");
    }
  );
  it("keeps workspace and stream admission on Save", async () => {
    const f = await fixture();
    await expect(f.create({ ...f.input, fromId: "foreign" })).rejects.toThrow("workspace");
    await expect(f.create({ ...f.input, data: { ...f.input.data, stream: "unsupported" } })).rejects.toThrow("stream");
    await expect(
      f.create({
        ...f.input,
        data: {
          ...f.input.data,
          streamOptions: {
            audience: { kind: "existing", audienceId: "123" },
            customerMatchTermsAccepted: true,
            mirrorStrategy: "full-replace",
          },
        },
      })
    ).rejects.toThrow("exclusive");
  });
  it("retains pause/delete/log access after rollout is disabled", async () => {
    const f = await fixture();
    const { id } = await f.create();
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false });
    await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: true });
    await expect(updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false })).rejects.toThrow();
    await expect(f.create()).rejects.toThrow();
    expect(await reverseTasks(f.prisma, f.workspace.id, { syncId: id })).toEqual([]);
    await expect(reverseLogs(f.prisma, "foreign", id, "task")).rejects.toThrow("not found");
    await deleteReverseSync(f.prisma, f.workspace.id, id);
  });
  it("requires pause and no active attempts before deletion", async () => {
    const f = await fixture();
    const { id } = await f.create();
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false });
    await expect(deleteReverseSync(f.prisma, f.workspace.id, id)).rejects.toThrow("Pause");
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: true });
    await f.prisma.source_task.create({
      data: { task_id: randomUUID(), sync_id: id, package: "jitsu/retl-runner", version: "test", status: "WAITING" },
    });
    await expect(deleteReverseSync(f.prisma, f.workspace.id, id)).rejects.toThrow("Cancel");
  });
  it("checks Kubernetes-compatible cron and timezone at the API boundary", async () => {
    const f = await fixture();
    for (const data of [{ schedule: "* * * * * *" }, { schedule: "@every 1m" }, { timezone: "not/a-zone" }])
      await expect(f.create({ ...f.input, data: { ...f.input.data, ...data } })).rejects.toThrow();
  });
});
