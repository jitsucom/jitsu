import { describe, expect, it } from "vitest";
import { randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { assertDestinationInWorkspace } from "../../lib/server/workspace-ownership";

const svc = () => new ConfigObjectsService({ prisma: deps().prisma });

describe("domain objects are unique across workspaces (JITSU-255)", () => {
  it("rejects a domain already claimed by another workspace, in any letter case", async () => {
    const name = `t-${randomId(8).toLowerCase()}.victim.example`;
    const a = await seedWorkspace();
    const b = await seedWorkspace();
    await svc().create(a.user, a.workspace.id, "domain", { name }, { generateId: true });

    await expect(
      svc().create(b.user, b.workspace.id, "domain", { name: name.toUpperCase() }, { generateId: true })
    ).rejects.toThrow(/already in use by other workspace/);
    expect(
      await deps().prisma.configurationObject.count({ where: { workspaceId: b.workspace.id, type: "domain" } })
    ).toBe(0);
  });

  it("rejects a domain that another workspace uses as a stream domain", async () => {
    const name = `s-${randomId(8).toLowerCase()}.victim.example`;
    const a = await seedWorkspace();
    const b = await seedWorkspace();
    await deps().prisma.configurationObject.create({
      data: { workspaceId: a.workspace.id, type: "stream", config: { name: "site", domains: [name] } },
    });

    await expect(svc().create(b.user, b.workspace.id, "domain", { name }, { generateId: true })).rejects.toThrow(
      /already in use by other workspace/
    );
  });

  it("still lets the owning workspace add and keep its own domain", async () => {
    const name = `own-${randomId(8).toLowerCase()}.example`;
    const a = await seedWorkspace();
    const created = await svc().create(a.user, a.workspace.id, "domain", { name }, { generateId: true });
    expect(created.id).toBeTruthy();
  });
});

describe("assertDestinationInWorkspace (JITSU-255)", () => {
  async function destination(workspaceId: string, extra: Record<string, any> = {}) {
    return deps().prisma.configurationObject.create({
      data: { workspaceId, type: "destination", config: { name: "wh", destinationType: "webhook" }, ...extra },
    });
  }

  it("accepts a destination of the same workspace and an empty reference", async () => {
    const { workspace } = await seedWorkspace();
    const dest = await destination(workspace.id);
    await expect(assertDestinationInWorkspace(deps().prisma, workspace.id, dest.id)).resolves.toBeUndefined();
    await expect(assertDestinationInWorkspace(deps().prisma, workspace.id, undefined)).resolves.toBeUndefined();
    await expect(assertDestinationInWorkspace(deps().prisma, workspace.id, null)).resolves.toBeUndefined();
  });

  it("rejects a destination of another workspace, a missing one, a deleted one and a non-destination", async () => {
    const mine = await seedWorkspace();
    const other = await seedWorkspace();
    const foreign = await destination(other.workspace.id);
    const deleted = await destination(mine.workspace.id, { deleted: true });
    const stream = await deps().prisma.configurationObject.create({
      data: { workspaceId: mine.workspace.id, type: "stream", config: { name: "site" } },
    });
    for (const id of [foreign.id, "does-not-exist", deleted.id, stream.id]) {
      await expect(assertDestinationInWorkspace(deps().prisma, mine.workspace.id, id)).rejects.toMatchObject({
        status: 400,
      });
    }
  });
});
