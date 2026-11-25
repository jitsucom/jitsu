import { describe, expect, it, vi } from "vitest";
import { createHash, randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { getUser } from "../../lib/api";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import workspaceListRoute from "../../pages/api/workspace/index";
import meRoute from "../../pages/api/me";

// JITSU-289: a key limited to one workspace lists only that workspace. The key cannot open the others, so it has no
// business seeing their names, slugs or feature flags. A key limited by role only, and an unrestricted key, keep every
// workspace of the user. The routes are called through their real handlers, with real keys and a real database.

async function seedTwoWorkspaces() {
  const a = await seedWorkspace();
  const b = await seedWorkspace();
  await deps().prisma.workspaceAccess.create({ data: { userId: a.user.internalId, workspaceId: b.workspace.id } });
  return { user: a.user, a: a.workspace, b: b.workspace };
}

async function keyString(userId: string, workspaceId?: string, role?: string) {
  const secret = randomId(24);
  const token = await deps().prisma.userApiToken.create({
    data: { hint: "x***", hash: createHash(secret), userId, workspaceId, role },
  });
  return `${token.id}:${secret}`;
}

async function bearerUser(key: string) {
  return (await getUser({} as any, { headers: { authorization: `Bearer ${key}` }, query: {}, cookies: {} } as any))!;
}

async function call(handler: any, method: string, key: string, body?: any, query: any = {}) {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, any>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
    send(b: any) {
      this.body = b;
      return this;
    },
    setHeader(k: string, v: any) {
      this.headers[k] = v;
    },
    getHeader(k: string) {
      return this.headers[k];
    },
    end() {},
  };
  await handler(
    { method, headers: { host: "localhost", authorization: `Bearer ${key}` }, query, body, cookies: {}, url: "/" },
    res
  );
  return res;
}

describe("a workspace-scoped key lists only its own workspace", () => {
  async function setup() {
    const { user, a, b } = await seedTwoWorkspaces();
    return {
      a,
      b,
      user,
      scoped: await keyString(user.internalId, a.id),
      roleOnly: await keyString(user.internalId, undefined, "analyst"),
      unrestricted: await keyString(user.internalId),
    };
  }

  it("GET /api/workspace, with the total", async () => {
    const { a, b, scoped, roleOnly, unrestricted } = await setup();
    const ids = (res: any) => (res.body.workspaces ?? res.body).map((w: any) => w.id);
    const scopedList = await call(workspaceListRoute, "GET", scoped, undefined, { page: "0" });
    expect(scopedList.statusCode).toBe(200);
    expect(ids(scopedList)).toEqual([a.id]);
    expect(scopedList.body.pagination.totalCount).toBe(1);
    // a key limited by role only, and an unrestricted key, keep every workspace of the user
    for (const key of [roleOnly, unrestricted]) {
      const res = await call(workspaceListRoute, "GET", key, undefined, { page: "0" });
      expect(ids(res).sort()).toEqual([a.id, b.id].sort());
      expect(res.body.pagination.totalCount).toBe(2);
    }
  });

  it("GET /api/me?workspaces=true", async () => {
    const { a, b, scoped, roleOnly, unrestricted } = await setup();
    const ids = (res: any) => (res.body.workspaces ?? []).map((w: any) => w.id);
    expect(ids(await call(meRoute, "GET", scoped, undefined, { workspaces: "true" }))).toEqual([a.id]);
    for (const key of [roleOnly, unrestricted]) {
      expect(ids(await call(meRoute, "GET", key, undefined, { workspaces: "true" })).sort()).toEqual(
        [a.id, b.id].sort()
      );
    }
  });

  it("the workspace list of the MCP tool, with the total", async () => {
    const { user, a, b } = await setup();
    const service = new ConfigObjectsService({ prisma: deps().prisma });
    const list = async (workspaceId?: string, role?: string) =>
      service.listWorkspaces(await bearerUser(await keyString(user.internalId, workspaceId, role)), {});
    const scoped = await list(a.id);
    expect(scoped.workspaces.map(w => w.id)).toEqual([a.id]);
    expect(scoped.total).toBe(1);
    expect((await list(undefined, "analyst")).workspaces.map(w => w.id).sort()).toEqual([a.id, b.id].sort());
    expect((await list()).total).toBe(2);
  });

  it("a scoped key of a platform admin lists its own workspace, not every workspace", async () => {
    const admin = await seedWorkspace({ admin: true });
    await seedWorkspace();
    const key = await keyString(admin.user.internalId, admin.workspace.id);
    const res = await call(workspaceListRoute, "GET", key, undefined, { page: "0" });
    expect(res.body.workspaces.map((w: any) => w.id)).toEqual([admin.workspace.id]);
  });
});

describe("a scoped key lists its workspace whenever it can open it (the same rule as verifyAccess)", () => {
  // A platform admin may scope a key to a workspace without joining it: verifyAccess lets an admin in. The key must then list
  // that workspace, or a CLI that resolves its target through the list fails with the right workspace id.
  async function adminKeyForForeignWorkspace() {
    const admin = await seedWorkspace({ admin: true, member: false });
    return { admin, key: await keyString(admin.user.internalId, admin.workspace.id) };
  }

  it("GET /api/workspace, with the total", async () => {
    const { admin, key } = await adminKeyForForeignWorkspace();
    const res = await call(workspaceListRoute, "GET", key, undefined, { page: "0" });
    expect(res.statusCode).toBe(200);
    expect(res.body.workspaces.map((w: any) => w.id)).toEqual([admin.workspace.id]);
    expect(res.body.pagination.totalCount).toBe(1);
  });

  it("GET /api/me?workspaces=true", async () => {
    const { admin, key } = await adminKeyForForeignWorkspace();
    const res = await call(meRoute, "GET", key, undefined, { workspaces: "true" });
    expect(res.body.workspaces.map((w: any) => w.id)).toEqual([admin.workspace.id]);
  });

  it("the workspace list of the MCP tool, with the total", async () => {
    const { admin, key } = await adminKeyForForeignWorkspace();
    const list = await new ConfigObjectsService({ prisma: deps().prisma }).listWorkspaces(await bearerUser(key), {});
    expect(list.workspaces.map(w => w.id)).toEqual([admin.workspace.id]);
    expect(list.total).toBe(1);
  });

  it("lists nothing when the key's workspace is one its user cannot open", async () => {
    // a key row can outlive a membership: the user left the workspace and is not an admin
    const { user, a } = await seedTwoWorkspaces();
    const key = await keyString(user.internalId, a.id);
    await deps().prisma.workspaceAccess.deleteMany({ where: { userId: user.internalId, workspaceId: a.id } });
    const res = await call(workspaceListRoute, "GET", key, undefined, { page: "0" });
    expect(res.body.workspaces).toEqual([]);
    expect(res.body.pagination.totalCount).toBe(0);
    expect((await call(meRoute, "GET", key, undefined, { workspaces: "true" })).body.workspaces).toEqual([]);
    const list = await new ConfigObjectsService({ prisma: deps().prisma }).listWorkspaces(await bearerUser(key), {});
    expect(list.workspaces).toEqual([]);
    expect(list.total).toBe(0);
  });
});

describe("the query that fetches the scoped workspace enforces membership by itself", () => {
  // The access decision and the fetch used to be two queries: an owner who removed a member between them still let the
  // removed member's key read the workspace's name, slug and feature flags. The race is hard to stage, so the property is
  // pinned instead: even when the earlier decision said yes (the membership count still reports 1), a user who is not a
  // member gets nothing from the fetch.
  it("a stale access check does not leak the workspace through any of the three lists", async () => {
    const { user, a } = await seedTwoWorkspaces();
    const key = await keyString(user.internalId, a.id);
    await deps().prisma.workspaceAccess.deleteMany({ where: { userId: user.internalId, workspaceId: a.id } });
    const count = vi.spyOn(deps().prisma.workspaceAccess, "count").mockResolvedValue(1 as any);
    try {
      const rest = await call(workspaceListRoute, "GET", key, undefined, { page: "0" });
      expect(rest.body.workspaces).toEqual([]);
      expect((await call(meRoute, "GET", key, undefined, { workspaces: "true" })).body.workspaces).toEqual([]);
      const list = await new ConfigObjectsService({ prisma: deps().prisma }).listWorkspaces(await bearerUser(key), {});
      expect(list.workspaces).toEqual([]);
    } finally {
      count.mockRestore();
    }
  });
});
