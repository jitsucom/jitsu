import { describe, expect, it } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { AuditLogService } from "../../lib/server/audit-log-service";

// The read side shared by /api/audit-log and the MCP get_audit_log tool:
// access checks, secret masking / diff reduction, origin filter and paging,
// all against real Postgres.

const svc = () => new AuditLogService({ prisma: deps().prisma });

async function seedRows(workspaceId: string, userId: string) {
  const prisma = deps().prisma;
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  const update = await prisma.auditLog.create({
    data: {
      timestamp: at(1),
      type: "config-object-update",
      workspaceId,
      userId,
      objectId: "dst1",
      authType: "mcp",
      changes: {
        objectType: "destination",
        prevVersion: { name: "ch", destinationType: "clickhouse", password: "old-secret", batchSize: 10 },
        newVersion: { name: "ch", destinationType: "clickhouse", password: "new-secret", batchSize: 20 },
        // The write side records rotated secret paths, because the per-type
        // outputFilter strips the secret on both sides and the masked diff
        // alone carries no signal (see lib/server/audit-log.ts).
        _rotatedSecrets: ["password"],
      },
    },
  });
  const login = await prisma.auditLog.create({
    data: { timestamp: at(2), type: "auth-login", workspaceId: null, userId, authType: "firebase" },
  });
  const bearer = await prisma.auditLog.create({
    data: {
      timestamp: at(3),
      type: "config-object-create",
      workspaceId,
      userId,
      objectId: "str1",
      authType: "bearer",
      tokenId: "jitsu-cli-abc",
      changes: { objectType: "stream", newVersion: { name: "site" } },
    },
  });
  return { update, login, bearer };
}

describe("AuditLogService", () => {
  it("lists a workspace's rows newest first with secrets masked and prev/next reduced to a diff", async () => {
    const { user, workspace } = await seedWorkspace();
    const rows = await seedRows(workspace.id, user.internalId!);

    const res = await svc().list(user, { workspaceId: workspace.id });
    expect(res.nextCursor).toBeUndefined();
    // Workspace-agnostic auth rows of current members are surfaced in the workspace view.
    expect(res.items.map(i => i.id)).toEqual([rows.bearer.id, rows.login.id, rows.update.id]);

    const upd = res.items.find(i => i.id === rows.update.id)!;
    // Raw config blobs never leave the server — only the summary fields do.
    expect(upd.changes).toEqual({ objectType: "destination", objectName: "ch" });
    expect(JSON.stringify(upd)).not.toContain("old-secret");
    expect(JSON.stringify(upd)).not.toContain("new-secret");
    expect(upd.diff).toEqual(
      expect.arrayContaining([
        { field: "password", kind: "secret-changed" },
        { field: "batchSize", kind: "changed", prev: "10", next: "20" },
      ])
    );
    expect(upd.diff).toHaveLength(2);
    expect(upd.actor).toEqual({ id: user.internalId, email: user.email, name: user.name });
    expect(upd.workspace).toEqual({ id: workspace.id, name: workspace.name, slug: workspace.slug });
  });

  it("accepts the workspace slug and pages with nextCursor", async () => {
    const { user, workspace } = await seedWorkspace();
    const rows = await seedRows(workspace.id, user.internalId!);

    const page1 = await svc().list(user, { workspaceId: workspace.slug!, limit: 2 });
    expect(page1.items.map(i => i.id)).toEqual([rows.bearer.id, rows.login.id]);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await svc().list(user, { workspaceId: workspace.slug!, limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map(i => i.id)).toEqual([rows.update.id]);
    expect(page2.nextCursor).toBeUndefined();
  });

  it("filters by origin, type and time window", async () => {
    const { user, workspace } = await seedWorkspace();
    const rows = await seedRows(workspace.id, user.internalId!);

    const mcp = await svc().list(user, { workspaceId: workspace.id, origin: "mcp" });
    expect(mcp.items.map(i => i.id)).toEqual([rows.update.id]);

    const cli = await svc().list(user, { workspaceId: workspace.id, origin: "cli" });
    expect(cli.items.map(i => i.id)).toEqual([rows.bearer.id]);

    const byType = await svc().list(user, { workspaceId: workspace.id, type: "auth-login" });
    expect(byType.items.map(i => i.id)).toEqual([rows.login.id]);

    const window = await svc().list(user, {
      workspaceId: workspace.id,
      from: new Date("2026-01-01T00:02:30.000Z"),
      to: new Date("2026-01-01T00:04:00.000Z"),
    });
    expect(window.items.map(i => i.id)).toEqual([rows.bearer.id]);

    await expect(svc().list(user, { workspaceId: workspace.id, origin: "ui,bogus" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("requires the owner role for a workspace and admin for the cross-workspace view", async () => {
    const { user: editor, workspace } = await seedWorkspace({ role: "editor" });
    await expect(svc().list(editor, { workspaceId: workspace.id })).rejects.toMatchObject({ status: 403 });

    const { user: outsider } = await seedWorkspace({ member: false });
    await expect(svc().list(outsider, { workspaceId: workspace.id })).rejects.toMatchObject({ status: 403 });

    const { user: owner } = await seedWorkspace();
    await expect(svc().list(owner, {})).rejects.toMatchObject({ status: 403 });
  });

  it("lets a platform admin read across workspaces", async () => {
    const { user: admin } = await seedWorkspace({ admin: true, member: false });
    const a = await seedWorkspace();
    const b = await seedWorkspace();
    const ra = await seedRows(a.workspace.id, a.user.internalId!);
    const rb = await seedRows(b.workspace.id, b.user.internalId!);

    const res = await svc().list(admin, { type: "config-object-update", limit: 200 });
    const ids = res.items.map(i => i.id);
    expect(ids).toContain(ra.update.id);
    expect(ids).toContain(rb.update.id);
  });
});
