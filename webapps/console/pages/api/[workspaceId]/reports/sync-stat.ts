import { createRoute, getWorkspace, verifyAccess } from "../../../../lib/api";
import { z } from "zod";
import dayjs from "dayjs";
import { db } from "../../../../lib/server/db";

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      start: z.coerce.date().optional(),
      end: z.coerce.date().optional(),
      granularity: z.enum(["day", "hour"]).optional().default("day"),
    }),
    result: z.any(),
  })
  .handler(async ({ user, query }) => {
    const { workspaceId } = query;
    const workspace = await getWorkspace(workspaceId);
    await verifyAccess(user, workspace.id);
    const end = query.end ? query.end.toISOString() : new Date().toISOString();
    const start = query.start ? query.start.toISOString() : dayjs(end).subtract(1, "month").toDate().toISOString();

    const res = await db.pgPool().query(
      `select
                count(distinct sync."fromId" || sync."toId") as "activeSyncs"
            from newjitsu.source_task task
                 join newjitsu."ConfigurationObjectLink" sync on task.sync_id = sync."id"
            where (task.status = 'SUCCESS' OR task.status = 'PARTIAL')
              and "workspaceId" = $1
              and started_at >= $2 and started_at < $3
            and deleted = false`,
      [workspaceId, start, end]
    );

    return {
      activeSyncs: res.rows[0].activeSyncs,
      start,
      end,
    };
  })
  .toNextApiHandler();
