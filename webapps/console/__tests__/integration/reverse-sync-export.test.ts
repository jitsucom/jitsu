import { describe, it, expect } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { exportReverseSyncs, readReverseSync } from "../../lib/server/reverse-sync-export";

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
