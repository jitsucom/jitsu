import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { randomId } from "juava";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import { getServerLog } from "../../../../lib/server/log";
import zlib from "zlib";
import { pipeline } from "node:stream";
import { clickhouse } from "../../../../lib/server/clickhouse";

const log = getServerLog("sync-logs");
const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";

//Vercel Limit:  https://vercel.com/docs/functions/streaming-functions#limitations-for-streaming-edge-functions
const maxStreamingResponseSize = 100_000_000;
// Too big responses may cause performance issues in the browser (that is compressed size - actual payload is much bigger)
const browserResponseSize = 1_000_000;

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
    const existingLink = await db
      .prisma()
      .configurationObjectLink.findFirst({ where: { workspaceId: workspaceId, id: query.syncId, deleted: false } });
    if (!existingLink) {
      res.writeHead(404, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ ok: false, error: `sync with id ${query.syncId} not found in the workspace` }));
      return;
    }
    let maxResponseSize = maxStreamingResponseSize;
    if (query.download) {
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Encoding": "gzip",
        "Content-Disposition": `attachment; filename=logs_sync_${query.syncId}_task_${query.taskId}.txt`,
      });
    } else {
      maxResponseSize = browserResponseSize;
      res.writeHead(200, {
        "Content-Encoding": "gzip",
        "Content-Type": "text/plain",
      });
    }
    try {
      var responsePromiseResolve;
      let responsePromise = new Promise<void>((resolve, reject) => {
        responsePromiseResolve = resolve;
      });
      const gzip = zlib.createGzip();
      pipeline(gzip, res, err => {
        if (err) {
          log.atError().withCause(err).log("Error piping data to response");
        }
        responsePromiseResolve();
      });
      const sqlQuery = `select timestamp, level, logger, message from ${metricsSchema}.task_log where task_id = {taskId:String} AND sync_id = {syncId:String} order by timestamp desc`;
      const chResult = await clickhouse.query({
        query: sqlQuery,
        query_params: {
          taskId: query.taskId,
          syncId: query.syncId,
        },
        format: "JSONCompactEachRow",
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      });
      const stream = chResult.stream();
      stream.on("data", rs => {
        for (const rw of rs) {
          const r = rw.json() as any;
          if (gzip.bytesWritten < maxStreamingResponseSize) {
            const line = `${dayjs(r[0]).utc().format("YYYY-MM-DD HH:mm:ss.SSS")} ${r[1]} [${r[2]}] ${r[3]}${
              query.download ? "\n" : "#ENDLINE#"
            }`;
            gzip.write(line);
          } else {
            stream.destroy();
          }
        }
      });
      stream.on("error", err => {
        log.atError().withCause(err).log("Error streaming data");
        gzip.end();
      });
      // stream.on("close", () => {
      //   log.atInfo().log("STREAM CLOSED");
      // });
      stream.on("end", async () => {
        log.atInfo().log("STREAM END: " + gzip.bytesWritten);
        if (gzip.bytesWritten > 0) {
          gzip.end();
          return;
        }
        log.atInfo().log("ACCESSING POSTGRES LOGS");
        await db.pgHelper().streamQuery(
          `select tl.*
                                from newjitsu.task_log tl join newjitsu."ConfigurationObjectLink" link on tl.sync_id = link.id
                                where task_id = :task_id and link."workspaceId" = :workspace_id
                                order by timestamp desc`,
          { task_id: query.taskId, workspace_id: workspaceId },
          r => {
            const line = `${dayjs(r.timestamp).utc().format("YYYY-MM-DD HH:mm:ss.SSS")} ${r.level} [${r.logger}] ${
              r.message
            }${query.download ? "\n" : "#ENDLINE#"}`;
            if (gzip.bytesWritten < maxResponseSize) {
              gzip.write(line);
            }
          }
        );
        if (gzip.bytesWritten === 0) {
          const task = await db.prisma().source_task.findFirst({ where: { task_id: query.taskId } });
          if (!task || task.status === "RUNNING") {
            gzip.write("The task is starting...");
          } else {
            gzip.write("No logs found for this task");
          }
        }
        gzip.end();
      });
      await responsePromise;
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
