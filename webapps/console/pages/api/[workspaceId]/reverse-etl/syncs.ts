import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseSyncInput, ReverseSyncView } from "../../../../lib/reverse-etl";
import { ReverseEtlService } from "../../../../lib/server/reverse-etl-service";

const query = z.object({ workspaceId: z.string() });
export const route = createRoute()
  .GET({ auth: true, query, result: z.array(ReverseSyncView) })
  .handler(async ({ user, query: { workspaceId }, res }) => {
    res.setHeader("Cache-Control", "no-store");
    return new ReverseEtlService(db.prisma()).list(user, workspaceId);
  })
  .POST({
    auth: true,
    mutates: true,
    query,
    body: z.object({ requestId: z.string().uuid(), sync: ReverseSyncInput }).strict(),
    result: z.object({ id: z.string() }),
  })
  .handler(async ({ user, query: { workspaceId }, body, req, res }) => {
    res.setHeader("Cache-Control", "no-store");
    return new ReverseEtlService(db.prisma()).create(user, workspaceId, body.requestId, body.sync, req);
  });
export default route.toNextApiHandler();
