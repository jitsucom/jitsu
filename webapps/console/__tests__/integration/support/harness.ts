import { randomId } from "juava";
import type { SessionUser } from "../../../lib/schema";
// Importing lib/server here is safe (and the whole point): setup.ts has already
// pointed env at this file's databases, so the prod singletons bind to them.
import { db } from "../../../lib/server/db";
import { clickhouse } from "../../../lib/server/clickhouse";

/** The real production singletons, bound to this test file's databases. */
export function deps() {
  return { prisma: db.prisma(), pgPool: db.pgPool(), clickhouse };
}

export type SeededWorkspace = {
  user: SessionUser;
  workspace: { id: string; name: string; slug: string | null };
};

/**
 * Create a userProfile + workspace + workspaceAccess and return them in the
 * shapes services expect. Each call creates a fresh, isolated workspace — tests
 * never share data. `admin: true` seeds a platform admin (no workspaceAccess
 * needed); `member: false` skips the workspaceAccess row (for negative access
 * tests).
 */
export async function seedWorkspace(
  opts: { admin?: boolean; member?: boolean; role?: "owner" | "editor" | "analyst" } = {}
): Promise<SeededWorkspace> {
  const prisma = db.prisma();
  const suffix = randomId(8).toLowerCase();
  const profile = await prisma.userProfile.create({
    data: {
      name: `Test User ${suffix}`,
      email: `test-${suffix}@example.com`,
      loginProvider: "credentials",
      externalId: `ext-${suffix}`,
      admin: opts.admin ?? false,
    },
  });
  const workspace = await prisma.workspace.create({
    data: { name: `ws-${suffix}`, slug: `ws-${suffix}` },
    select: { id: true, name: true, slug: true },
  });
  if (opts.member !== false) {
    await prisma.workspaceAccess.create({
      data: { userId: profile.id, workspaceId: workspace.id, ...(opts.role ? { role: opts.role } : {}) },
    });
  }
  const user: SessionUser = {
    internalId: profile.id,
    externalId: profile.externalId,
    externalUsername: profile.name,
    loginProvider: profile.loginProvider,
    email: profile.email,
    name: profile.name,
    authType: "bearer",
    tokenId: `tok-${suffix}`,
  };
  return { user, workspace };
}
