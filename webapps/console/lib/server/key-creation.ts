import type { PrismaClient } from "@prisma/client";
import { SessionUser } from "../schema";
import { ApiError } from "../shared/errors";
import { verifyAccess } from "../api";

/**
 * API keys and MCP tokens must not be able to mint further keys: a stolen or leaked key would otherwise turn into
 * keys that outlive its revocation, and a scoped key into an unscoped one. Keys are created from a signed-in session.
 */
export function assertCanCreateKey(user: Pick<SessionUser, "authType">): void {
  if (user.authType === "bearer" || user.authType === "mcp") {
    throw new ApiError("API keys can only be created from a signed-in session, not with another API key", {
      status: 403,
    });
  }
}

/**
 * Resolves the workspace a new key is limited to (id or slug) and checks the creating user belongs to it.
 * Returns undefined for an unscoped key.
 */
export async function resolveKeyWorkspace(
  prisma: PrismaClient,
  user: SessionUser,
  workspace: string | null | undefined
): Promise<string | undefined> {
  if (!workspace) {
    return undefined;
  }
  const found = await prisma.workspace.findFirst({
    where: { OR: [{ id: workspace }, { slug: workspace }], deleted: false },
    select: { id: true },
  });
  if (!found) {
    throw new ApiError(`Workspace ${workspace} not found`, { status: 404 });
  }
  await verifyAccess(user, found.id);
  return found.id;
}
