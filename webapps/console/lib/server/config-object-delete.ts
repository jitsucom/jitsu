import type { Prisma } from "@prisma/client";
import type { ConfigApiDeleteOptions } from "../useApi";
import { ApiError } from "../shared/errors";

/**
 * Handles linked connections check and deletion for stream, destination, and service objects.
 * Called by server-side delete hooks using the mutation transaction.
 */
export async function handleLinkedConnections(
  workspaceId: string,
  objectId: string,
  objectType: string,
  tx: Prisma.TransactionClient,
  options?: ConfigApiDeleteOptions
): Promise<void> {
  if (!options?.strict && !options?.cascade) {
    return;
  }
  // Check for linked connections
  const linkedConnections = await tx.configurationObjectLink.findMany({
    where: {
      workspaceId,
      deleted: false,
      OR: [{ fromId: objectId }, { toId: objectId }],
    },
  });
  if (linkedConnections.length === 0) {
    return;
  }

  // Cascade takes precedence over strict
  if (options?.cascade) {
    // Delete all linked connections before deleting the object.
    // Sync deletions are picked up by syncctl on its next /api/admin/export/syncs poll.
    for (const link of linkedConnections) {
      await tx.configurationObjectLink.update({
        where: { id: link.id },
        data: { deleted: true },
      });
    }
  } else if (options?.strict) {
    throw new ApiError(`Cannot delete ${objectType} because it has ${linkedConnections.length} linked connections`, {
      status: 409,
      responseObject: {
        code: "LINKED_CONNECTIONS_EXIST",
        linkedConnectionsCount: linkedConnections.length,
        linkedConnections: linkedConnections.map(link => ({
          id: link.id,
          type: link.type || "push",
          fromId: link.fromId,
          toId: link.toId,
        })),
      },
    });
  }
}

export async function checkFunctionReferences(
  tx: Prisma.TransactionClient,
  original: { id: string; workspaceId: string },
  options?: ConfigApiDeleteOptions
) {
  if (!options?.strict) {
    return;
  }

  // Check if function is used in any connections
  const allLinks = await tx.configurationObjectLink.findMany({
    where: { workspaceId: original.workspaceId, deleted: false, type: "push" },
  });

  const connectionsUsingFunction = allLinks.filter(link => {
    const functions = link.data?.["functions"];
    if (Array.isArray(functions)) {
      return functions.some((f: any) => f.functionId === "udf." + original.id);
    }
    return false;
  });

  // Check if function is used in any profile builders
  const profileBuilders = await tx.profileBuilder.findMany({
    where: { workspaceId: original.workspaceId, deleted: false },
  });

  const profileBuildersUsingFunction = profileBuilders.filter(pb => {
    const functions = pb.connectionOptions?.["functions"];
    if (Array.isArray(functions)) {
      return functions.some((f: any) => f.functionId === "udf." + original.id);
    }
    return false;
  });

  if (connectionsUsingFunction.length > 0 || profileBuildersUsingFunction.length > 0) {
    throw new ApiError(
      `Cannot delete function because it is being used by ${connectionsUsingFunction.length} connection(s) and ${profileBuildersUsingFunction.length} profile builder(s)`,
      {
        status: 409,
        responseObject: {
          code: "FUNCTION_IN_USE",
          connectionsCount: connectionsUsingFunction.length,
          profileBuildersCount: profileBuildersUsingFunction.length,
          connections: connectionsUsingFunction.map(link => ({
            id: link.id,
            type: link.type || "push",
            fromId: link.fromId,
            toId: link.toId,
          })),
          profileBuilders: profileBuildersUsingFunction.map(pb => ({
            id: pb.id,
            name: pb.name,
          })),
        },
      }
    );
  }
}
