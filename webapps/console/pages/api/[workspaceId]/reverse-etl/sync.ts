import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseSyncSettings, ReverseSyncInput } from "../../../../lib/reverse-etl";
import { ReverseEtlService, ReverseSyncAction } from "../../../../lib/server/reverse-etl-service";

const query = z.object({ workspaceId: z.string(), syncId: z.string() });
export const route = createRoute()
  .PUT({
    auth: true,
    mutates: true,
    query,
    body: z.union([ReverseSyncInput, ReverseSyncSettings]),
    result: z.object({ id: z.string() }),
  })
  .handler(async ({ user, query: { workspaceId, syncId }, body, req }) => {
    return new ReverseEtlService(db.prisma()).update(user, workspaceId, syncId, body, req);
  })
  .DELETE({ auth: true, mutates: true, query, result: z.object({ id: z.string() }) })
  .handler(async ({ user, query: { workspaceId, syncId }, req }) => {
    return new ReverseEtlService(db.prisma()).delete(user, workspaceId, syncId, req);
  })
  .POST({
    auth: true,
    mutates: true,
    query,
    body: ReverseSyncAction,
    result: z.object({ status: z.string(), taskId: z.string().optional() }),
  })
  .handler(async ({ user, query: { workspaceId, syncId }, body, req, res }) => {
    res.setHeader("Cache-Control", "no-store");
    return new ReverseEtlService(db.prisma()).act(user, workspaceId, syncId, body, req);
  });
export default route.toNextApiHandler();
