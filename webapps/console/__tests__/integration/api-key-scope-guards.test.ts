import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { getUser, verifyAccessWithRole, verifyAdmin } from "../../lib/api";
import changePasswordRoute from "../../pages/api/user/change-password";
import keysRoute from "../../pages/api/user/keys";
import cliKeyRoute from "../../pages/api/user/cli-key";
import workspaceRoute from "../../pages/api/workspace/index";
import meRoute from "../../pages/api/me";
import healthcheckDbRoute from "../../pages/api/healthcheck/db";
import domainsReportRoute from "../../pages/api/admin/domains-report";
import emailTemplateRoute from "../../pages/api/admin/email-templates/[template]";
import adminUsersRoute from "../../pages/api/admin/users";

// JITSU-288: guards of JITSU-264 (workspace-scoped and role-limited API keys) that no test failed without. A reviewer
// reverted each guard one at a time and every test still passed. Each test below fails when its guard is reverted; the
// guard is named in the test. The routes are called through their real handlers, with real keys and a real database.

// the email templates are not what is tested and need the mjml renderer
vi.mock("../../lib/server/templates", () => ({}));
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
    writeHead(code: number) {
      this.statusCode = code;
    },
    write() {},
    end() {},
  };
  const headers: Record<string, string> = { host: "localhost", ...(key ? { authorization: `Bearer ${key}` } : {}) };
  await handler({ method, headers, query, body, cookies: {}, url: "/" }, res);
  return res;
}

const text = (res: any) => (typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? ""));
const LIMITED = /limited to a workspace or role/;
const NOT_FOR_ADMIN = /limited and can't be used for admin operations/;

describe("a limited key cannot change the password (assertNotLimitedKey in user/change-password)", () => {
  it("is refused, and the password stays; an unrestricted key can change it", async () => {
    const { user, a } = await seedTwoWorkspaces();
    await deps().prisma.userPassword.create({ data: { userId: user.internalId, hash: createHash("old-password-1") } });
    const stored = async () =>
      (await deps().prisma.userPassword.findFirstOrThrow({ where: { userId: user.internalId } })).hash;
    const before = await stored();
    const body = { currentPassword: "old-password-1", newPassword: "new-password-1" };
    for (const key of [
      await keyString(user.internalId, a.id),
      await keyString(user.internalId, undefined, "analyst"),
    ]) {
      const res = await call(changePasswordRoute, "POST", key, body);
      expect(res.statusCode).toBe(403);
      expect(text(res)).toMatch(LIMITED);
    }
    expect(await stored()).toBe(before);

    const ok = await call(changePasswordRoute, "POST", await keyString(user.internalId), body);
    expect(ok.statusCode).toBe(200);
    expect(await stored()).not.toBe(before);
  });
});

describe("a key cannot create keys, through the handlers (assertCanCreateKey in user/keys and user/cli-key)", () => {
  it("POST /api/user/keys refuses an unrestricted, a scoped and a role-limited key, and writes nothing", async () => {
    const { user, a } = await seedTwoWorkspaces();
    const count = () => deps().prisma.userApiToken.count({ where: { userId: user.internalId } });
    const keys = [
      await keyString(user.internalId),
      await keyString(user.internalId, a.id),
      await keyString(user.internalId, undefined, "analyst"),
    ];
    const before = await count();
    for (const key of keys) {
      const res = await call(keysRoute, "POST", key, { name: "minted" });
      expect(res.statusCode).toBe(403);
      expect(text(res)).toMatch(/signed-in session/);
    }
    expect(await count()).toBe(before);
  });

  it("GET /api/user/cli-key refuses a key and writes nothing, and works for a session", async () => {
    const { user, a } = await seedTwoWorkspaces();
    const cliKeys = () => deps().prisma.userApiToken.count({ where: { userId: user.internalId, type: "cli" } });
    for (const key of [await keyString(user.internalId), await keyString(user.internalId, a.id)]) {
      const res = await call(cliKeyRoute, "GET", key);
      expect(res.statusCode).toBe(403);
      expect(text(res)).toMatch(/signed-in session/);
    }
    expect(await cliKeys()).toBe(0);

    asSession(user);
    const ok = await call(cliKeyRoute, "GET", undefined);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toMatchObject({ type: "cli" });
    expect(await cliKeys()).toBe(1);
  });
});

describe("a key created through the API keeps its workspace and role (keys.ts stores them)", () => {
  it("stores workspaceId and role, shows them in the response, and the new key is limited when used", async () => {
    const { user, a, b } = await seedTwoWorkspaces();
    asSession(user);
    const res = await call(keysRoute, "POST", undefined, { name: "scoped", workspaceId: a.slug, role: "analyst" });
    expect(res.statusCode).toBe(200);
    // given by slug, stored by id
    expect(res.body).toMatchObject({ workspaceId: a.id, role: "analyst" });
    expect(await deps().prisma.userApiToken.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({
      workspaceId: a.id,
      role: "analyst",
    });

    const principal = await bearerUser(`${res.body.id}:${res.body.plaintext}`);
    expect(principal).toMatchObject({ tokenWorkspaceId: a.id, tokenRole: "analyst" });
    await expect(verifyAccessWithRole(principal, a.id, "readEntities")).resolves.toMatchObject({ role: "analyst" });
    await expect(verifyAccessWithRole(principal, a.id, "editEntities")).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessWithRole(principal, b.id, "readEntities")).rejects.toMatchObject({ status: 403 });
  });

  it("an unscoped key from a session stays unscoped", async () => {
    const { user } = await seedTwoWorkspaces();
    asSession(user);
    const res = await call(keysRoute, "POST", undefined, { name: "plain" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ workspaceId: null, role: null });
  });
});

describe("a limited key of a platform admin is refused by the admin routes that moved to verifyAdmin", () => {
  const routes: [string, any, string, any][] = [
    ["healthcheck/db", healthcheckDbRoute, "GET", {}],
    ["admin/domains-report", domainsReportRoute, "GET", {}],
    ["admin/email-templates/[template]", emailTemplateRoute, "POST", { template: "any" }],
    ["admin/users", adminUsersRoute, "GET", {}],
  ];

  it.each(routes)("%s", async (_name, handler, method, query) => {
    const admin = await seedWorkspace({ admin: true });
    const id = admin.user.internalId;
    const body = method === "POST" ? { props: {} } : undefined;
    for (const key of [await keyString(id, admin.workspace.id), await keyString(id, undefined, "analyst")]) {
      const res = await call(handler, method, key, body, query);
      expect(res.statusCode, `${_name}: a limited key must be refused`).toBeGreaterThanOrEqual(400);
      // the reason is the limited key, not a failure somewhere after the guard
      expect(text(res)).toMatch(NOT_FOR_ADMIN);
    }
    // the same admin with an unrestricted key gets past the guard (other failures, such as a missing renderer, may follow)
    const open = await call(handler, method, await keyString(id), body, query);
    expect(text(open)).not.toMatch(NOT_FOR_ADMIN);
    expect(text(open)).not.toMatch(/is not an admin/);
  });

  it("healthcheck/db answers an unrestricted admin key and refuses an unrestricted key of a non-admin", async () => {
    const admin = await seedWorkspace({ admin: true });
    const ok = await call(healthcheckDbRoute, "GET", await keyString(admin.user.internalId));
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toHaveProperty("pgBouncer");
    const member = await seedWorkspace();
    const refused = await call(healthcheckDbRoute, "GET", await keyString(member.user.internalId));
    expect(refused.statusCode).toBe(403);
    expect(text(refused)).toMatch(/is not an admin/);
  });
});

describe("verifyAdmin says why a limited key is refused (the explicit throw)", () => {
  it("names the key limit for a limited key of an admin and the missing admin flag for a non-admin", async () => {
    const admin = await seedWorkspace({ admin: true });
    const limited = await bearerUser(await keyString(admin.user.internalId, undefined, "analyst"));
    await expect(verifyAdmin(limited)).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(NOT_FOR_ADMIN),
    });
    const member = await seedWorkspace();
    const plain = await bearerUser(await keyString(member.user.internalId));
    await expect(verifyAdmin(plain)).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/is not an admin/),
    });
  });
});

describe("the workspace lists of an admin's limited key are the admin's own (isPlatformAdmin in workspace and me)", () => {
  async function setup() {
    const admin = await seedWorkspace({ admin: true });
    const other = await seedWorkspace();
    return {
      admin,
      other,
      unrestricted: await keyString(admin.user.internalId),
      limited: [
        await keyString(admin.user.internalId, admin.workspace.id),
        await keyString(admin.user.internalId, undefined, "analyst"),
      ],
    };
  }

  it("GET /api/workspace", async () => {
    const { admin, other, unrestricted, limited } = await setup();
    const all = await call(workspaceRoute, "GET", unrestricted);
    expect(all.statusCode).toBe(200);
    expect(text(all)).toContain(other.workspace.id);
    for (const key of limited) {
      const res = await call(workspaceRoute, "GET", key);
      expect(res.statusCode).toBe(200);
      expect(text(res)).toContain(admin.workspace.id);
      expect(text(res)).not.toContain(other.workspace.id);
    }
  });

  it("GET /api/me?workspaces=true", async () => {
    const { admin, other, unrestricted, limited } = await setup();
    const ids = (res: any) => (res.body.workspaces ?? []).map((w: any) => w.id);
    const all = await call(meRoute, "GET", unrestricted, undefined, { workspaces: "true" });
    expect(ids(all)).toContain(other.workspace.id);
    for (const key of limited) {
      const res = await call(meRoute, "GET", key, undefined, { workspaces: "true" });
      expect(ids(res)).toContain(admin.workspace.id);
      expect(ids(res)).not.toContain(other.workspace.id);
    }
  });
});

describe("the role cap tells the branches apart (limitToTokenRole)", () => {
  it("an admin without a membership gets the permissions of the key's role, not an owner's", async () => {
    const admin = await seedWorkspace({ admin: true });
    const foreign = await seedWorkspace();
    const analyst = await bearerUser(await keyString(admin.user.internalId, undefined, "analyst"));
    const editor = await bearerUser(await keyString(admin.user.internalId, undefined, "editor"));
    const unrestricted = await bearerUser(await keyString(admin.user.internalId));
    // the admin has no membership in the foreign workspace: the answer comes from the admin branch
    await expect(verifyAccessWithRole(analyst, foreign.workspace.id, "readEntities")).resolves.toEqual({
      role: "analyst",
      readEntities: true,
      editEntities: false,
      deleteEntities: false,
      manageUsers: false,
    });
    await expect(verifyAccessWithRole(editor, foreign.workspace.id, "readEntities")).resolves.toMatchObject({
      role: "editor",
      editEntities: true,
      manageUsers: false,
    });
    await expect(verifyAccessWithRole(unrestricted, foreign.workspace.id, "readEntities")).resolves.toMatchObject({
      role: "owner",
      manageUsers: true,
    });
  });

  it("never raises the role of the user, and lowers a higher one to the key's", async () => {
    const analystMember = await seedWorkspace({ role: "analyst" });
    const ownerKey = await bearerUser(await keyString(analystMember.user.internalId, undefined, "owner"));
    await expect(verifyAccessWithRole(ownerKey, analystMember.workspace.id, "readEntities")).resolves.toEqual({
      role: "analyst",
      readEntities: true,
      editEntities: false,
      deleteEntities: false,
      manageUsers: false,
    });

    const editorMember = await seedWorkspace({ role: "editor" });
    const analystKey = await bearerUser(await keyString(editorMember.user.internalId, undefined, "analyst"));
    await expect(verifyAccessWithRole(analystKey, editorMember.workspace.id, "readEntities")).resolves.toMatchObject({
      role: "analyst",
      editEntities: false,
      deleteEntities: false,
    });
  });
});
