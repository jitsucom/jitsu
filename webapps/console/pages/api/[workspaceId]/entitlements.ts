import { z } from "zod";
import { createRoute, verifyAccess } from "../../../lib/api";
import { resolveEntitlements } from "../../../lib/server/plan-gate";
import { db } from "../../../lib/server/db";
import { requireDefined } from "juava";

/** null means access could not be determined, not that an upgrade is required. */
export const WorkspaceEntitlements = z.object({
  customDomains: z.boolean().nullable(),
  identityStitching: z.boolean().nullable(),
});

export default createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    result: WorkspaceEntitlements,
  })
  .handler(async ({ user, req, query: { workspaceId } }) => {
    await verifyAccess(user, workspaceId);
    const workspace = requireDefined(
      await db.prisma().workspace.findFirst({ where: { id: workspaceId, deleted: false } }),
      `Workspace ${workspaceId} not found`
    );
    return await resolveEntitlements(user, workspace, req);
  })
  .toNextApiHandler();
