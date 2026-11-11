import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../shared/errors";

/**
 * A reference to a destination must stay inside the workspace that stores it: rotor and bulker only check that
 * the destination id exists, so a foreign id would make this workspace write into someone else's destination.
 */
export async function assertDestinationInWorkspace(
  prisma: PrismaClient,
  workspaceId: string,
  destinationId: string | null | undefined
): Promise<void> {
  if (!destinationId) {
    return;
  }
  const destination = await prisma.configurationObject.findFirst({
    where: { id: destinationId, workspaceId, type: "destination", deleted: false },
    select: { id: true },
  });
  if (!destination) {
    throw new ApiError(`Destination ${destinationId} does not exist in this workspace`, { status: 400 });
  }
}
