import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { ServiceConfig } from "../../../../lib/schema";
import { syncService } from "../../../../lib/server/route-services";

const resultType = z.object({
  ok: z.boolean(),
  pending: z.boolean().optional(),
  error: z.string().optional(),
});

export default createRoute()
  .POST({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      storageKey: z.string(),
    }),
    body: ServiceConfig,
    result: resultType,
  })
  .handler(async ({ user, query, body }) => {
    return syncService().triggerSourceCheck(user, query.workspaceId, {
      config: body,
      storageKey: query.storageKey,
    });
  })
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      storageKey: z.string(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query }) => {
    return syncService().getSourceCheckResult(user, query.workspaceId, query.storageKey);
  })
  .toNextApiHandler();
