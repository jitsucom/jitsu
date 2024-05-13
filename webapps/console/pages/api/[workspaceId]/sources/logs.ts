import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { randomId } from "juava";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import { getServerLog } from "../../../../lib/server/log";

const log = getServerLog("sync-logs");
const maxResponseSize = 4500000;

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      taskId: z.string(),
      syncId: z.string(),
      download: z.string().optional(),
    }),
    streaming: true,
  })
  .handler(async ({ user, query, res }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    if (query.download) {
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename=logs_sync_${query.syncId}_task_${query.taskId}.txt`,
      });
    } else {
      res.writeHead(200, {
        "Content-Type": "text/plain",
      });
    }
    try {
      let writtenBytes = 0;
      db.prisma().$queryRaw;
      await db.pgHelper().streamQuery(
        `select tl.*
                                from newjitsu.task_log tl join newjitsu."ConfigurationObjectLink" link on tl.sync_id = link.id
                                where task_id = :task_id and link."workspaceId" = :workspace_id
                                order by timestamp desc`,
        { task_id: query.taskId, workspace_id: workspaceId },
        r => {
          const line = `${dayjs(r.timestamp).utc().format("YYYY-MM-DD HH:mm:ss.SSS")} ${r.level} [${r.logger}] ${
            r.message
          }\n`;
          if (writtenBytes + line.length < maxResponseSize) {
            res.write(line);
            writtenBytes += line.length;
          }
        }
      );
      if (writtenBytes === 0) {
        const task = await db.prisma().source_task.findFirst({ where: { task_id: query.taskId } });
        if (!task || task.status === "RUNNING") {
          res.write("The task is starting...");
        } else {
          res.write("No logs found for this task");
        }
      }
    } catch (e: any) {
      const errorId = randomId();
      log
        .atError()
        .withCause(e)
        .log(
          `Error loading logs for task id ${query.taskId} in workspace ${workspaceId}. Error ID: ${errorId}. Error: ${e}`
        );
      res.write(`Error loading logs for task id ${query.taskId} Error ID: ${errorId}. Error: ${e}`);
    } finally {
      res.end();
    }
  })
  .toNextApiHandler();
