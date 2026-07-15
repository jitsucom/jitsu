import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { syncService } from "../../../../lib/server/route-services";

const resultType = z.object({
  ok: z.boolean(),
  state: z.record(z.string()).optional(),
  error: z.string().optional(),
});

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query }) => {
    return syncService().getSyncState(user, query.workspaceId, query.syncId);
  })
  .POST({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
      stream: z.string(),
    }),
    body: z.object({}).passthrough().optional(),
    result: resultType,
  })
  .handler(async ({ user, query, body }) => {
    const { workspaceId, syncId, stream } = query;
    if (!body || Object.keys(body).length === 0) {
      return syncService().resetSyncState(user, workspaceId, { syncId, stream });
    }
    return syncService().setSyncState(user, workspaceId, { syncId, stream, state: body });
  })
  .toNextApiHandler();
