import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { randomId } from "juava";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      taskId: z.string(),
      syncId: z.string(),
      download: z.string().optional(),
    }),
  })
  .handler(async ({ user, query, res }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    res.setHeader("Content-Type", "text/plain");
    if (query.download) {
      res.setHeader("Content-Disposition", `attachment; filename=logs_sync_${query.syncId}_task_${query.taskId}.txt`);
    }
    try {
      await db.pgHelper().streamQuery(
        `select *
                                from task_log
                                where task_id = :task_id
                                order by timestamp`,
        { task_id: query.taskId },
        r => {
          res.write(
            `${dayjs(r.timestamp).utc().format("YYYY-MM-DD HH:mm:ss.SSS")} ${r.level} [${r.logger}] ${r.message}\n`
          );
        }
      );
      res.end();
    } catch (e: any) {
      const errorId = randomId();
      console.error(
        `Error loading logs for task id ${query.taskId} in workspace ${workspaceId}. Error ID: ${errorId}. Error: ${e}`
      );
      return {
        ok: false,
        error: `couldn't load tasks due to internal server error. Please contact support. Error ID: ${errorId}`,
      };
    }
  })
  .toNextApiHandler();
