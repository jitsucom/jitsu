import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseSyncSetup, ReverseSyncView } from "../../../../lib/reverse-etl";
import { createReverseSync, discardReverseCreation, listReverseSyncs } from "../../../../lib/server/reverse-syncs";
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
    body: z.object({ requestId: z.string().uuid(), setup: ReverseSyncSetup }).strict(),
    result: z.object({ id: z.string() }),
  })
  .handler(async ({ user, query: { workspaceId }, body, req, res }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    const result = await createReverseSync(db.prisma(), workspaceId, body.requestId, body.setup);
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
  })
  .DELETE({
    auth: true,
    mutates: true,
    query: query.extend({ requestId: z.string().uuid() }),
    summary: "Discard an unsaved reverse sync creation request",
    result: z.object({ status: z.enum(["saved", "discarded"]), id: z.string().optional() }),
  })
  .handler(async ({ user, query: { workspaceId, requestId }, res }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    return discardReverseCreation(db.prisma(), workspaceId, requestId);
  });
export default route.toNextApiHandler();
