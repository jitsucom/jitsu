import { describe, expect, it } from "vitest";
import { createHash, randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { getUser, verifyAccess, verifyAccessWithRole } from "../../lib/api";
import { assertCanCreateKey, resolveKeyWorkspace } from "../../lib/server/key-creation";

// JITSU-264: a UserApiToken used to reach every workspace of its user, and a key could mint further keys.

async function seedTwoWorkspaces() {
  const a = await seedWorkspace();
  const b = await seedWorkspace();
  // the same user belongs to both
  await deps().prisma.workspaceAccess.create({ data: { userId: a.user.internalId, workspaceId: b.workspace.id } });
  return { user: a.user, a: a.workspace, b: b.workspace };
}

async function bearerUser(userId: string, workspaceId?: string) {
  const secret = randomId(24);
  const token = await deps().prisma.userApiToken.create({
    data: { hint: "x***", hash: createHash(secret), userId, workspaceId },
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
