import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { syncService } from "../../../../lib/server/route-services";

export default createRoute()
  .GET({
    auth: true,
    // Dispatches /cancel to syncctl — side-effect outside the Prisma backstop,
    // so explicitly opt into the maintenance gate.
    mutates: true,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
      taskId: z.string(),
      // Unused: the service resolves the package from the sync itself. Kept so
      // existing callers that still send it don't fail query validation.
      package: z.string().optional(),
    }),
    result: z.any(),
  })
  .handler(async ({ user, query }) => {
    return syncService().cancelSync(user, query.workspaceId, { syncId: query.syncId, taskId: query.taskId });
  })
  .toNextApiHandler();
