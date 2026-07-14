import { describe, expect, it } from "vitest";
import { randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { MASKED_SECRET } from "../../lib/schema/destinations";

async function seedStreamDestLink(workspaceId: string) {
  const prisma = deps().prisma;
  const stream = await prisma.configurationObject.create({
    data: { workspaceId, type: "stream", config: { name: "site" } },
  });
  const dest = await prisma.configurationObject.create({
    data: { workspaceId, type: "destination", config: { name: "wh", destinationType: "webhook" } },
  });
  const link = await prisma.configurationObjectLink.create({
    data: { workspaceId, fromId: stream.id, toId: dest.id, data: {} },
  });
  return { stream, dest, link };
}

// Real Postgres via the harness: the service runs against a per-file database,
// and the shared helpers it delegates to (verifyAccess, configObjectAuditLog)
// hit the same database through the db.prisma() singleton — so access checks
// and audit rows are asserted for real instead of being mocked away.

const svc = () => new ConfigObjectsService({ prisma: deps().prisma });

describe("ConfigObjectsService", () => {
  it("rejects unknown resource types", async () => {
    const { user, workspace } = await seedWorkspace();
    await expect(svc().list(user, workspace.id, "bogus")).rejects.toThrow(/Unknown resource type/);
  });

  it("denies access to a user without workspaceAccess (real verifyAccess)", async () => {
    const { workspace } = await seedWorkspace();
    const { user: stranger } = await seedWorkspace(); // member of a different workspace only
    await expect(svc().list(stranger, workspace.id, "domain")).rejects.toMatchObject({ status: 403 });
  });

  it("create mints an id, strips id/workspaceId from stored config, and writes an audit row", async () => {
    const { user, workspace } = await seedWorkspace();
    const res = await svc().create(user, workspace.id, "domain", { name: "Example.COM" }, { generateId: true });
    expect(res.id).toBeTruthy();

    const row = await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id: res.id } });
    expect(row.type).toBe("domain");
    expect(row.workspaceId).toBe(workspace.id);
    // stored config carries the payload but not id/workspaceId (those live in columns)
    const config = row.config as any;
    expect(config.id).toBeUndefined();
    expect(config.workspaceId).toBeUndefined();
    expect(config.name).toBe("example.com"); // domain inputFilter lowercases

    // the audit-log helper ran for real against the same database
    const audit = await deps().prisma.auditLog.findFirst({
      where: { workspaceId: workspace.id, objectId: res.id, type: "config-object-create" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(user.internalId);
  });

  it("audit rows mask destination secrets", async () => {
    const { user, workspace } = await seedWorkspace();
    const res = await svc().create(
      user,
      workspace.id,
      "destination",
      { name: "pg", destinationType: "postgres", database: "events", password: "hunter2", host: "db.internal" },
      { generateId: true }
    );
    const audit = await deps().prisma.auditLog.findFirstOrThrow({
      where: { objectId: res.id, type: "config-object-create" },
    });
    const newVersion = (audit.changes as any)?.newVersion;
    expect(newVersion.password).toBe(MASKED_SECRET);
    expect(newVersion.host).toBe("db.internal");
    // the stored object itself keeps the real secret
    const row = await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id: res.id } });
    expect((row.config as any).password).toBe("hunter2");
  });

  it("create without an id and no generateId fails validation (HTTP contract)", async () => {
    const { user, workspace } = await seedWorkspace();
    // The HTTP route requires the client to send an id; a missing one must stay a
    // validation error rather than get an implicitly minted id.
    await expect(svc().create(user, workspace.id, "domain", { name: "example.com" })).rejects.toThrow(
      /validate schema/
    );
    expect(await deps().prisma.configurationObject.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });

  it("delete returns null when the object is missing (idempotent)", async () => {
    const { user, workspace } = await seedWorkspace();
    await expect(svc().delete(user, workspace.id, "destination", "nope")).resolves.toBeNull();
  });

  it("delete soft-deletes and writes an audit row", async () => {
    const { user, workspace } = await seedWorkspace();
    const { id } = await svc().create(user, workspace.id, "domain", { name: "gone.example.com" }, { generateId: true });
    const deleted = await svc().delete(user, workspace.id, "domain", id);
    expect(deleted).toMatchObject({ id, name: "gone.example.com" });
    const row = await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } });
    expect(row.deleted).toBe(true);
    const audit = await deps().prisma.auditLog.findFirst({ where: { objectId: id, type: "config-object-delete" } });
    expect(audit).not.toBeNull();
  });

  it("list maps stored rows to objects with id/type/workspaceId", async () => {
    const { user, workspace } = await seedWorkspace();
    await deps().prisma.configurationObject.create({
      data: {
        id: "d1",
        workspaceId: workspace.id,
        type: "destination",
        config: { name: "dest", destinationType: "postgres" },
      },
    });
    // another workspace's destination must not appear
    const { workspace: foreign } = await seedWorkspace();
    await deps().prisma.configurationObject.create({
      data: { workspaceId: foreign.id, type: "destination", config: { name: "foreign", destinationType: "postgres" } },
    });

    const objects = await svc().list(user, workspace.id, "destination");
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ id: "d1", type: "destination", workspaceId: workspace.id, name: "dest" });
  });

  it("listWorkspaces uses workspaceAccess for non-admins", async () => {
    const { user, workspace } = await seedWorkspace();
    await seedWorkspace(); // someone else's workspace — must not appear
    const res = await svc().listWorkspaces(user);
    expect(res.workspaces).toEqual([{ id: workspace.id, name: workspace.name, slug: workspace.slug }]);
    expect(res.total).toBe(1);
    expect(res.hasMore).toBe(false);
  });

  it("listWorkspaces lists all workspaces for admins", async () => {
    const { workspace: wsA } = await seedWorkspace();
    const { workspace: wsB } = await seedWorkspace();
    const { user: admin } = await seedWorkspace({ admin: true, member: false });
    const res = await svc().listWorkspaces(admin, { limit: 100 });
    // the file shares one database: other tests' workspaces exist too — assert superset
    const ids = res.workspaces.map(w => w.id);
    expect(ids).toEqual(expect.arrayContaining([wsA.id, wsB.id]));
  });

  it("listWorkspaces caps the page at 100 and pages with hasMore", async () => {
    const prisma = deps().prisma;
    const { user } = await seedWorkspace();
    // two more workspaces for the same user (three total)
    for (let i = 0; i < 2; i++) {
      const ws = await prisma.workspace.create({ data: { name: `ws-extra-${randomId(6)}` } });
      await prisma.workspaceAccess.create({ data: { userId: user.internalId, workspaceId: ws.id } });
    }
    const capped = await svc().listWorkspaces(user, { limit: 999, offset: 0 });
    expect(capped.limit).toBe(100); // 999 clamps to the page max
    expect(capped.total).toBe(3);

    const paged = await svc().listWorkspaces(user, { limit: 2, offset: 0 });
    expect(paged.workspaces).toHaveLength(2);
    expect(paged.hasMore).toBe(true);
    const rest = await svc().listWorkspaces(user, { limit: 2, offset: 2 });
    expect(rest.workspaces).toHaveLength(1);
    expect(rest.hasMore).toBe(false);
  });

  it("get constrains the lookup by type (so a wrong-type id can't run the wrong filter)", async () => {
    const { user, workspace } = await seedWorkspace();
    const stream = await deps().prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "stream", config: { name: "site" } },
    });
    await expect(svc().get(user, workspace.id, "destination", stream.id)).rejects.toThrow(/does not exist/);
    // the same id resolves fine under its true type
    const viaRightType = await svc().get(user, workspace.id, "stream", stream.id);
    expect(viaRightType).toMatchObject({ id: stream.id, name: "site" });
  });

  it("updateLink targets the link by id and rejects a from/to that doesn't match", async () => {
    const { user, workspace } = await seedWorkspace();
    const { link } = await seedStreamDestLink(workspace.id);

    await expect(svc().updateLink(user, workspace.id, link.id, { fromId: "x", data: {} })).rejects.toThrow(
      /does not match/
    );

    const res = await svc().updateLink(user, workspace.id, link.id, { data: { batchSize: 10 } });
    expect(res).toEqual({ id: link.id, updated: true });
    const row = await deps().prisma.configurationObjectLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.data).toEqual({ batchSize: 10 });
    const audit = await deps().prisma.auditLog.findFirst({
      where: { objectId: link.id, type: "config-object-update" },
    });
    expect(audit).not.toBeNull();
  });

  it("updateLink rejects changing a connection's type", async () => {
    const { user, workspace } = await seedWorkspace();
    const { link } = await seedStreamDestLink(workspace.id);
    await expect(svc().updateLink(user, workspace.id, link.id, { type: "sync", data: {} })).rejects.toThrow(
      /type can't be changed/
    );
  });

  it("deleteLink by id returns {deleted:false} for a missing connection (no throw)", async () => {
    const { user, workspace } = await seedWorkspace();
    await expect(svc().deleteLink(user, workspace.id, { id: "nope" })).resolves.toEqual({ deleted: false });
  });
});
