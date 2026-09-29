import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseSyncInput, ReverseSyncView } from "../../../../lib/reverse-etl";
import { createReverseSync, listReverseSyncs } from "../../../../lib/server/reverse-syncs";
import { configObjectAuditLog } from "../../../../lib/server/audit-log";

const query = z.object({ workspaceId: z.string() });
export const route = createRoute()
  .GET({ auth: true, query, result: z.array(ReverseSyncView) })
  .handler(async ({ user, query: { workspaceId }, res }) => {
    await verifyAccessWithRole(user, workspaceId, "readEntities");
    res.setHeader("Cache-Control", "no-store");
    return listReverseSyncs(db.prisma(), workspaceId);
  })
  .POST({
    auth: true,
    mutates: true,
    query,
    body: z.object({ requestId: z.string().uuid(), sync: ReverseSyncInput }).strict(),
    result: z.object({ id: z.string() }),
  })
  .handler(async ({ user, query: { workspaceId }, body, req, res }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    const result = await createReverseSync(db.prisma(), workspaceId, body.requestId, body.sync);
    await configObjectAuditLog(
      user,
      workspaceId,
      result.id,
      "link",
      "create",
      { newVersion: { type: "reverse-sync" } },
      req
    );
    return result;
  });
export default route.toNextApiHandler();
