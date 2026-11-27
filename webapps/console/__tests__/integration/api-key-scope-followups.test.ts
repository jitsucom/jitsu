import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { getUser, verifyAccessWithRole } from "../../lib/api";
import { getUserPreferenceService } from "../../lib/server/user-preferences";
import notificationsRoute from "../../pages/api/user/notifications-settings";
import keysRoute from "../../pages/api/user/keys";
import propertiesRoute from "../../pages/api/user/properties";
import workspaceRoute from "../../pages/api/workspace/[workspaceIdOrSlug]/index";
import meRoute from "../../pages/api/me";

// JITSU-289: small gaps of workspace-scoped and role-limited API keys (JITSU-264). Each test fails when its fix is reverted.
// The routes are called through their real handlers, with real keys and a real database.

// A browser session is a principal that is not a key: getUser takes it from here when there is no Authorization header.
const session = vi.hoisted(() => ({ user: undefined as any }));
vi.mock("../../lib/server/firebase-server", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/server/firebase-server")>()),
  isFirebaseEnabled: () => true,
  getFirebaseUser: async () => session.user,
}));

beforeEach(() => {
  session.user = undefined;
});

const asSession = (user: any) => {
  session.user = { ...user, authType: "firebase", tokenId: undefined };
};

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

/** Calls a route handler as a key (`key` given) or as the signed-in session (`key` undefined). */
async function call(handler: any, method: string, key: string | undefined, body?: any, query: any = {}) {
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
  const headers: Record<string, string> = { host: "localhost", ...(key ? { authorization: `Bearer ${key}` } : {}) };
  await handler({ method, headers, query, body, cookies: {}, url: "/" }, res);
  return res;
}

const text = (res: any) => (typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? ""));
const LIMITED = /limited to a workspace or role/;

describe("notification settings are account-level: a limited key cannot read or change them", () => {
  it("is refused with 403 and writes nothing; an unrestricted key can read and change them", async () => {
    const { user, a } = await seedTwoWorkspaces();
    const rows = () => deps().prisma.userPreferences.count({ where: { userId: user.internalId } });
    const before = await rows();
    for (const key of [
      await keyString(user.internalId, a.id),
      await keyString(user.internalId, undefined, "analyst"),
    ]) {
      const read = await call(notificationsRoute, "GET", key);
      expect(read.statusCode).toBe(403);
      expect(text(read)).toMatch(LIMITED);
      for (const workspaceId of [undefined, a.id]) {
        const write = await call(notificationsRoute, "POST", key, { syncs: false }, { workspaceId });
        expect(write.statusCode).toBe(403);
        expect(text(write)).toMatch(LIMITED);
      }
    }
    expect(await rows()).toBe(before);

    const open = await keyString(user.internalId);
    expect((await call(notificationsRoute, "GET", open)).statusCode).toBe(200);
    expect((await call(notificationsRoute, "POST", open, { syncs: false })).statusCode).toBe(200);
    expect(await rows()).toBe(before + 1);
    expect((await call(notificationsRoute, "GET", open)).body).toMatchObject({ syncs: false });
  });
});

describe("an empty workspaceId on key creation is refused, not an unscoped key", () => {
  it("answers 400 for '' and writes nothing; null and a missing workspaceId still give an unscoped key", async () => {
    const { user } = await seedTwoWorkspaces();
    asSession(user);
    const count = () => deps().prisma.userApiToken.count({ where: { userId: user.internalId } });
    const before = await count();
    for (const workspaceId of ["", "   "]) {
      const res = await call(keysRoute, "POST", undefined, { name: "empty", workspaceId });
      expect(res.statusCode, `workspaceId ${JSON.stringify(workspaceId)}`).toBe(400);
    }
    expect(await count()).toBe(before);

    for (const body of [{ name: "null", workspaceId: null }, { name: "missing" }]) {
      const res = await call(keysRoute, "POST", undefined, body);
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ workspaceId: null });
    }
  });
});

describe("the response of PATCH /api/user/keys shows the workspace and role of the key", () => {
  it("does not make a scoped key look unscoped", async () => {
    const { user, a } = await seedTwoWorkspaces();
    const scopedId = randomId(32);
    await deps().prisma.userApiToken.create({
      data: {
        id: scopedId,
        hint: "x***",
        hash: createHash("secret"),
        userId: user.internalId,
        workspaceId: a.id,
        role: "analyst",
      },
    });
    // only a key that is not limited may change keys
    const res = await call(keysRoute, "PATCH", await keyString(user.internalId), { name: "renamed" }, { id: scopedId });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: scopedId, name: "renamed", workspaceId: a.id, role: "analyst" });
  });
});

describe("a limited key of a platform admin does not bypass the billing read-only lock", () => {
  it("is refused an edit in a read-only workspace; an unrestricted admin key still bypasses, and reads stay open", async () => {
    const admin = await seedWorkspace({ admin: true });
    const id = admin.user.internalId;
    await deps().prisma.workspace.update({
      where: { id: admin.workspace.id },
      data: { featuresEnabled: ["readonly"] },
    });
    const editor = await bearerUser(await keyString(id, undefined, "editor"));
    const scoped = await bearerUser(await keyString(id, admin.workspace.id));
    for (const key of [editor, scoped]) {
      await expect(verifyAccessWithRole(key, admin.workspace.id, "editEntities")).rejects.toMatchObject({
        status: 403,
        responseObject: expect.objectContaining({ readonly: true }),
      });
      await expect(verifyAccessWithRole(key, admin.workspace.id, "readEntities")).resolves.toBeDefined();
    }
    const unrestricted = await bearerUser(await keyString(id));
    await expect(verifyAccessWithRole(unrestricted, admin.workspace.id, "editEntities")).resolves.toBeDefined();
  });
});

describe("the billing lock also applies on the admin fallback, where the admin has no membership", () => {
  it("refuses an edit to a limited key of an admin who is not a member; an unrestricted admin key still bypasses", async () => {
    // member: false, the admin has no membership row in the workspace: the answer comes from the admin fallback
    const admin = await seedWorkspace({ admin: true, member: false });
    const id = admin.user.internalId;
    const ws = admin.workspace.id;
    await deps().prisma.workspace.update({ where: { id: ws }, data: { featuresEnabled: ["readonly"] } });
    const editor = await bearerUser(await keyString(id, undefined, "editor"));
    const scoped = await bearerUser(await keyString(id, ws));
    for (const key of [editor, scoped]) {
      for (const permission of ["editEntities", "deleteEntities"] as const) {
        await expect(verifyAccessWithRole(key, ws, permission)).rejects.toMatchObject({
          status: 403,
          responseObject: expect.objectContaining({ readonly: true }),
        });
      }
      await expect(verifyAccessWithRole(key, ws, "readEntities")).resolves.toBeDefined();
    }
    const unrestricted = await bearerUser(await keyString(id));
    await expect(verifyAccessWithRole(unrestricted, ws, "editEntities")).resolves.toBeDefined();
  });
});

describe("GET /api/me?lastWorkspace=true stays within the key's scope", () => {
  it("does not show a scoped key a workspace it is kept out of; other keys see the last-used workspace", async () => {
    const { user, a, b } = await seedTwoWorkspaces();
    const preferences = getUserPreferenceService(deps().prisma);
    const lastUsed = async (key: string) =>
      (await call(meRoute, "GET", key, undefined, { lastWorkspace: "true" })).body?.lastUsedWorkspace;
    const scoped = await keyString(user.internalId, a.id);
    const roleOnly = await keyString(user.internalId, undefined, "analyst");
    const unrestricted = await keyString(user.internalId);

    // the user last opened workspace B; the key is scoped to A
    await preferences.savePreference({ userId: user.internalId }, { lastUsedWorkspaceId: b.id });
    expect(await lastUsed(scoped)).toBeUndefined();
    expect(await lastUsed(roleOnly)).toMatchObject({ id: b.id });
    expect(await lastUsed(unrestricted)).toMatchObject({ id: b.id });

    // the last-used workspace is the key's own: it is shown
    await preferences.savePreference({ userId: user.internalId }, { lastUsedWorkspaceId: a.id });
    expect(await lastUsed(scoped)).toMatchObject({ id: a.id });
  });
});

describe("GET /api/user/properties does not tell a limited key whether the user is an admin", () => {
  it("answers admin: false to a limited key of an admin, true to an unrestricted key, false to a non-admin", async () => {
    const admin = await seedWorkspace({ admin: true });
    const id = admin.user.internalId;
    const adminOf = async (key: string) => (await call(propertiesRoute, "GET", key)).body;
    expect(await adminOf(await keyString(id))).toEqual({ admin: true });
    expect(await adminOf(await keyString(id, admin.workspace.id))).toEqual({ admin: false });
    expect(await adminOf(await keyString(id, undefined, "analyst"))).toEqual({ admin: false });
    const member = await seedWorkspace();
    expect(await adminOf(await keyString(member.user.internalId))).toEqual({ admin: false });
  });
});

describe("reading a workspace through a limited key does not change the user's last-used workspace", () => {
  it("writes nothing for a limited key, and still records it for an unrestricted key", async () => {
    const { user, a } = await seedTwoWorkspaces();
    const properties = () =>
      deps().prisma.workspaceUserProperties.count({ where: { userId: user.internalId, workspaceId: a.id } });
    const lastUsed = async () =>
      (await getUserPreferenceService(deps().prisma).getPreferences({ userId: user.internalId })).lastUsedWorkspaceId;
    for (const key of [
      await keyString(user.internalId, a.id),
      await keyString(user.internalId, undefined, "analyst"),
    ]) {
      const res = await call(workspaceRoute, "GET", key, undefined, { workspaceIdOrSlug: a.id });
      expect(res.statusCode).toBe(200);
    }
    expect(await properties()).toBe(0);
    expect(await lastUsed()).toBeUndefined();

    const open = await call(workspaceRoute, "GET", await keyString(user.internalId), undefined, {
      workspaceIdOrSlug: a.id,
    });
    expect(open.statusCode).toBe(200);
    expect(await properties()).toBe(1);
    expect(await lastUsed()).toBe(a.id);
  });
});
