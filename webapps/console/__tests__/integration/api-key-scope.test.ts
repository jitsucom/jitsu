import { describe, expect, it, vi } from "vitest";
import { createHash, randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { getUser, isPlatformAdmin, verifyAccess, verifyAccessWithRole, verifyAdmin } from "../../lib/api";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { api as emailTemplatesApi } from "../../pages/api/admin/email-templates/index";
import { assertCanCreateKey, resolveKeyWorkspace } from "../../lib/server/key-creation";
import { AuthChecker } from "../../lib/server/mcp-server/auth";
import { OAuthHandlers } from "../../lib/server/mcp-server/oauth";
import { principalFromAuth } from "../../lib/server/mcp-server/tools";

// the email templates are not what is tested and need the mjml renderer
vi.mock("../../lib/server/templates", () => ({}));

// JITSU-264: a UserApiToken used to reach every workspace of its user, and a key could mint further keys.

async function seedTwoWorkspaces() {
  const a = await seedWorkspace();
  const b = await seedWorkspace();
  // the same user belongs to both
  await deps().prisma.workspaceAccess.create({ data: { userId: a.user.internalId, workspaceId: b.workspace.id } });
  return { user: a.user, a: a.workspace, b: b.workspace };
}

async function bearerUser(userId: string, workspaceId?: string, role?: string) {
  const secret = randomId(24);
  const token = await deps().prisma.userApiToken.create({
    data: { hint: "x***", hash: createHash(secret), userId, workspaceId, role },
  });
  const req: any = { headers: { authorization: `Bearer ${token.id}:${secret}` }, query: {}, cookies: {} };
  return (await getUser({} as any, req))!;
}

describe("workspace-scoped API keys", () => {
  it("an unscoped key keeps working in every workspace of its user", async () => {
    const { user, a, b } = await seedTwoWorkspaces();
    const key = await bearerUser(user.internalId);
    expect(key.tokenWorkspaceId).toBeNull();
    await expect(verifyAccess(key, a.id)).resolves.toBeUndefined();
    await expect(verifyAccess(key, b.id)).resolves.toBeUndefined();
  });

  it("a scoped key works only in its workspace, by id and by slug", async () => {
    const { user, a, b } = await seedTwoWorkspaces();
    const key = await bearerUser(user.internalId, a.id);
    expect(key.tokenWorkspaceId).toBe(a.id);

    await expect(verifyAccess(key, a.id)).resolves.toBeUndefined();
    await expect(verifyAccess(key, a.slug!)).resolves.toBeUndefined();
    await expect(verifyAccess(key, b.id)).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccess(key, b.slug!)).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessWithRole(key, a.id, "readEntities")).resolves.toMatchObject({ role: "owner" });
    await expect(verifyAccessWithRole(key, b.id, "readEntities")).rejects.toMatchObject({ status: 403 });
  });

  it("a scoped key of a platform admin does not reach other workspaces either", async () => {
    const admin = await seedWorkspace({ admin: true });
    const other = await seedWorkspace();
    const key = await bearerUser(admin.user.internalId, admin.workspace.id);
    await expect(verifyAccess(key, other.workspace.id)).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessWithRole(key, other.workspace.id, "editEntities")).rejects.toMatchObject({ status: 403 });
  });
});

describe("role-limited API keys", () => {
  it("cannot do more than its role, even for an owner", async () => {
    const { user, workspace } = await seedWorkspace(); // owner
    const analyst = await bearerUser(user.internalId, undefined, "analyst");
    const editor = await bearerUser(user.internalId, undefined, "editor");
    const unlimited = await bearerUser(user.internalId);

    expect(analyst.tokenRole).toBe("analyst");
    await expect(verifyAccessWithRole(analyst, workspace.id, "readEntities")).resolves.toMatchObject({
      role: "analyst",
    });
    await expect(verifyAccessWithRole(analyst, workspace.id, "editEntities")).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessWithRole(analyst, workspace.id, "manageUsers")).rejects.toMatchObject({ status: 403 });

    await expect(verifyAccessWithRole(editor, workspace.id, "editEntities")).resolves.toBeDefined();
    await expect(verifyAccessWithRole(editor, workspace.id, "deleteEntities")).resolves.toBeDefined();
    await expect(verifyAccessWithRole(editor, workspace.id, "manageUsers")).rejects.toMatchObject({ status: 403 });

    await expect(verifyAccessWithRole(unlimited, workspace.id, "manageUsers")).resolves.toBeDefined();
  });

  it("returns permissions capped at the key's role, so callers cannot unmask secrets or list invitation links", async () => {
    const { user, workspace } = await seedWorkspace(); // owner
    const analyst = await bearerUser(user.internalId, undefined, "analyst");
    const editor = await bearerUser(user.internalId, undefined, "editor");
    const unlimited = await bearerUser(user.internalId);
    await expect(verifyAccessWithRole(analyst, workspace.id, "readEntities")).resolves.toEqual({
      role: "analyst",
      readEntities: true,
      editEntities: false,
      deleteEntities: false,
      manageUsers: false,
    });
    await expect(verifyAccessWithRole(editor, workspace.id, "readEntities")).resolves.toMatchObject({
      role: "editor",
      editEntities: true,
      manageUsers: false,
    });
    await expect(verifyAccessWithRole(unlimited, workspace.id, "readEntities")).resolves.toMatchObject({
      role: "owner",
      manageUsers: true,
    });
  });

  it("does not raise the role of the user", async () => {
    const analystUser = await seedWorkspace({ role: "analyst" });
    const key = await bearerUser(analystUser.user.internalId, undefined, "owner");
    await expect(verifyAccessWithRole(key, analystUser.workspace.id, "editEntities")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("applies to platform admins too", async () => {
    const admin = await seedWorkspace({ admin: true });
    const other = await seedWorkspace();
    const key = await bearerUser(admin.user.internalId, undefined, "analyst");
    await expect(verifyAccessWithRole(key, other.workspace.id, "editEntities")).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessWithRole(key, other.workspace.id, "readEntities")).resolves.toBeDefined();
  });
});

describe("creating keys", () => {
  it("is refused for API keys and MCP tokens, allowed from a session", () => {
    expect(() => assertCanCreateKey({ authType: "bearer" })).toThrowError(/signed-in session/);
    expect(() => assertCanCreateKey({ authType: "mcp" })).toThrowError(/signed-in session/);
    for (const authType of ["firebase", "next-auth", "oidc", undefined]) {
      expect(() => assertCanCreateKey({ authType })).not.toThrow();
    }
  });

  it("limits a key to a workspace the user belongs to, given by id or slug", async () => {
    const { user, a } = await seedTwoWorkspaces();
    const prisma = deps().prisma;
    expect(await resolveKeyWorkspace(prisma, user, undefined)).toBeUndefined();
    expect(await resolveKeyWorkspace(prisma, user, a.id)).toBe(a.id);
    expect(await resolveKeyWorkspace(prisma, user, a.slug)).toBe(a.id);
  });

  it("refuses a workspace the user does not belong to or that does not exist", async () => {
    const mine = await seedWorkspace();
    const foreign = await seedWorkspace();
    const prisma = deps().prisma;
    await expect(resolveKeyWorkspace(prisma, mine.user, foreign.workspace.id)).rejects.toMatchObject({ status: 403 });
    await expect(resolveKeyWorkspace(prisma, mine.user, "no-such-workspace")).rejects.toMatchObject({ status: 404 });
  });
});

describe("restricted keys on platform admin routes", () => {
  it("a platform admin's scoped or role-limited key is refused, an unrestricted one is not", async () => {
    const admin = await seedWorkspace({ admin: true });
    const id = admin.user.internalId;
    await expect(verifyAdmin(await bearerUser(id))).resolves.toBeUndefined();
    await expect(verifyAdmin(await bearerUser(id, admin.workspace.id))).rejects.toMatchObject({ status: 403 });
    await expect(verifyAdmin(await bearerUser(id, undefined, "analyst"))).rejects.toMatchObject({ status: 403 });
  });
});

describe("platform-admin reach follows the key limits, not just the admin flag", () => {
  it("isPlatformAdmin is true for a session and an unrestricted key, false for a limited key and for a non-admin", async () => {
    const admin = await seedWorkspace({ admin: true });
    const id = admin.user.internalId;
    expect(await isPlatformAdmin(admin.user)).toBe(true);
    expect(await isPlatformAdmin(await bearerUser(id))).toBe(true);
    expect(await isPlatformAdmin(await bearerUser(id, admin.workspace.id))).toBe(false);
    expect(await isPlatformAdmin(await bearerUser(id, undefined, "analyst"))).toBe(false);
    const member = await seedWorkspace();
    expect(await isPlatformAdmin(await bearerUser(member.user.internalId))).toBe(false);
  });

  it("an admin route that used to read the flag itself refuses a limited key", async () => {
    const admin = await seedWorkspace({ admin: true });
    const id = admin.user.internalId;
    const handle = (user: any) => (emailTemplatesApi.GET as any).handle({ user });
    await expect(handle(await bearerUser(id))).resolves.toHaveProperty("templates");
    await expect(handle(await bearerUser(id, admin.workspace.id))).rejects.toMatchObject({ status: 403 });
    await expect(handle(await bearerUser(id, undefined, "analyst"))).rejects.toMatchObject({ status: 403 });
  });

  it("the workspace list of an admin's limited key is the admin's own, not every workspace", async () => {
    const admin = await seedWorkspace({ admin: true });
    const other = await seedWorkspace();
    const svc = new ConfigObjectsService({ prisma: deps().prisma });
    const ids = async (user: any) => (await svc.listWorkspaces(user, {})).workspaces.map((w: any) => w.id);
    expect(await ids(await bearerUser(admin.user.internalId))).toContain(other.workspace.id);
    expect(await ids(await bearerUser(admin.user.internalId, admin.workspace.id))).not.toContain(other.workspace.id);
    expect(await ids(await bearerUser(admin.user.internalId, undefined, "analyst"))).not.toContain(other.workspace.id);
  });
});

describe("restricted keys through MCP", () => {
  async function mcpPrincipal(userId: string, workspaceId?: string, role?: string) {
    const secret = randomId(24);
    const token = await deps().prisma.userApiToken.create({
      data: { hint: "x***", hash: createHash(secret), userId, workspaceId, role },
    });
    const res: any = { headersSent: false, setHeader() {}, status: () => res, json: () => res };
    const info = await new AuthChecker(deps().prisma, () => {}).requireAccessToken(
      { headers: { authorization: `Bearer ${token.id}:${secret}` } } as any,
      res
    );
    return principalFromAuth(info);
  }

  it("keeps the workspace scope and the role limit of the key", async () => {
    const { user, a, b } = await seedTwoWorkspaces();
    const scoped = await mcpPrincipal(user.internalId, a.id);
    await expect(verifyAccess(scoped, a.id)).resolves.toBeUndefined();
    await expect(verifyAccess(scoped, b.id)).rejects.toMatchObject({ status: 403 });

    const analyst = await mcpPrincipal(user.internalId, undefined, "analyst");
    await expect(verifyAccessWithRole(analyst, a.id, "readEntities")).resolves.toBeDefined();
    await expect(verifyAccessWithRole(analyst, a.id, "editEntities")).rejects.toMatchObject({ status: 403 });

    const unrestricted = await mcpPrincipal(user.internalId);
    await expect(verifyAccessWithRole(unrestricted, b.id, "editEntities")).resolves.toBeDefined();
  });
});

describe("approving an OAuth client", () => {
  it("is refused to an API key", async () => {
    const { user } = await seedWorkspace();
    const secret = randomId(24);
    const token = await deps().prisma.userApiToken.create({
      data: { hint: "x***", hash: createHash(secret), userId: user.internalId, role: "analyst" },
    });
    const res: any = {
      statusCode: 200,
      body: undefined,
      setHeader() {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      },
    };
    const req: any = {
      method: "POST",
      headers: { authorization: `Bearer ${token.id}:${secret}` },
      query: {},
      cookies: {},
      body: {
        client_id: "x",
        redirect_uri: "https://example.com/cb",
        code_challenge: "c",
        code_challenge_method: "S256",
      },
    };
    const handlers = new OAuthHandlers({
      prisma: deps().prisma,
      kv: {},
      accessTokenTtlSec: 3600,
      refreshTokenTtlDays: 30,
    } as any);
    await handlers.approve(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "forbidden" });
  });
});
