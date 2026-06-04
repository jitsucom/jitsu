import { createRoute, verifyAdmin } from "../../../lib/api";
import { z } from "zod";
import { getServerLog } from "../../../lib/server/log";
import { db } from "../../../lib/server/db";
import { getErrorMessage } from "juava";
import dayjs from "dayjs";

const workspaceSyncRunsQuery = require("../../../prisma/workspace-sync-runs.sql").default;

const log = getServerLog("sync-log-trim");

function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

async function getTaskLogSize() {
  return (await db.pgPool().query("SELECT pg_total_relation_size('newjitsu.task_log') AS table_size")).rows[0]
    .table_size;
}

const WorkspaceSyncRunsStatRow = z.object({
  workspaceId: z.string(),
  workspaceSlug: z.string(),
  runs: z.coerce.number(),
  lastSync: z.coerce.string(),
  //uniqueSyncs: z.coerce.number(),
  //latestSyncId: z.string().
});

async function getLogEntries(user: any) {
  return db.prisma().task_log.count();
}

const maxEntries = 5_000_000;
export default createRoute()
  .GET({
    auth: true,
    // GET but deletes (task_log.deleteMany). The k8s CronJob will get 503
    // during maintenance and skip; resumes when maintenance ends.
    mutates: true,
    query: z.object({
      token: z.string().optional(),
    }),
  })
  .handler(async ({ req, res, query, user }) => {
    await verifyAdmin(user);
    const result = {};
    log.atInfo().log("Cleaning logs. Gathering initial stat");
    const logEntries = await getLogEntries(user);
    const sizeBytes = await getTaskLogSize();
    const avgRecordSize = Math.floor(sizeBytes / logEntries);
    log.atInfo().log(`Avg record size: ${formatNumber(avgRecordSize)} bytes`);
    const sizeGb = sizeBytes / 1_000_000_000;
    log.atInfo().log(`Log entries count: ${formatNumber(logEntries)}. Size: ${sizeGb.toFixed(2)} GB`);
    const rawResult = (await db.pgPool().query(workspaceSyncRunsQuery)).rows;

    const workspaceStat = rawResult.map(row => {
      try {
        return WorkspaceSyncRunsStatRow.parse(row);
      } catch (e: any) {
        throw new Error(`Failed to parse row ${JSON.stringify(row)}: ${getErrorMessage(e)}`);
      }
    });
    log.atInfo().log(`Got stat for ${workspaceStat.length} workspaces`);

    //only clean workspace runs with significant amount of runs
    const eligibleWorkspaces = workspaceStat.filter(ws => ws.runs > 10);
    for (const workspace of eligibleWorkspaces) {
      log.atInfo().log(`Cleaning workspace ${workspace.workspaceId} / ${workspace.workspaceSlug}`);
      const syncs = await db.prisma().configurationObjectLink.findMany({
        where: { workspaceId: workspace.workspaceId, type: "sync" },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
      });
      log.atInfo().log(`Found ${syncs.length} unique syncs for ${workspace.workspaceId} / ${workspace.workspaceSlug}`);
      const maxLogEntriesPerSync = Math.floor(maxEntries / syncs.length);
      for (const sync of syncs) {
        log
          .atInfo()
          .log(
            `🗑️Cleaning sync ${sync.id} of ${workspace.workspaceId} / ${workspace.workspaceSlug}. Obtaining log entries count`
          );
        let logEntriesStat = await db
          .pgPool()
          .query("SELECT COUNT(*) as count, min(timestamp) as min FROM newjitsu.task_log WHERE sync_id = $1", [
            sync.id,
          ]);
        let { count: logEntries, min: minTimestamp } = logEntriesStat.rows[0];
        //logEntries return count as string. No idea why, maybe pg driver issue?
        if (logEntries === 0 || logEntries === "0") {
          log.atInfo().log(`Sync ${sync.id} has no log entries. Skipping`);
          continue;
        }
        if (logEntries < maxLogEntriesPerSync) {
          log
            .atInfo()
            .log(
              `Sync ${sync.id} has ${formatNumber(logEntries)} < ${formatNumber(
                maxLogEntriesPerSync
              )} log entries. Oldest entry: ${minTimestamp.toISOString()}, skipping`
            );
          continue;
        }
        log
          .atInfo()
          .log(
            `📈Sync ${sync.id} has ${formatNumber(
              logEntries
            )} log entries. Deleting some of them. Obtaining cut off date first`
          );
        const lastSuccessfullSync = await db.prisma().source_task.findFirst({
          where: { sync_id: sync.id, status: "SUCCESS" },
          orderBy: { updated_at: "desc" },
        });
        const lastFailedSync = await db.prisma().source_task.findFirst({
          where: { sync_id: sync.id, status: "FAILED" },
          orderBy: { updated_at: "desc" },
        });
        log
          .atInfo()
          .log(
            `Last successful sync: ${lastSuccessfullSync?.updated_at}. Last failed sync: ${lastFailedSync?.updated_at}`
          );
        //we always need to keep last successful and last failed syncs. And keep logs for at least 2 days

        const cutoffDate = dayjs(
          Math.min(
            dayjs().subtract(3, "days").toDate().getTime(),
            lastFailedSync?.updated_at.getTime() || new Date().getTime(),
            lastSuccessfullSync?.updated_at.getTime() || new Date().getTime()
          )
        ).add(-1, "day"); //add buffer just in case of timezones differences, etc
        log
          .atInfo()
          .log(
            `Cut off date for sync ${sync.id} is ${cutoffDate
              .toDate()
              .toISOString()}. Logs older than that will be considered for deletion`
          );

        await db.pgHelper().streamQuery(
          //take tasks that has been updated after oldest log entry, all other tasks will have no logs. Add buffer of 1 day to avoid timezone issues
          `SELECT task_id, updated_at FROM newjitsu.source_task WHERE sync_id = $1 AND updated_at < $2 and updated_at > $3 ORDER BY updated_at`,
          [sync.id, cutoffDate.toDate(), dayjs(minTimestamp).add(-1, "day").toDate()],
          async row => {
            const sourceTaskId = row.task_id;
            const lastUpdated = row.updated_at;
            log.atInfo().log(`Deleting logs for source task ${sourceTaskId} updated at ${lastUpdated}`);
            const deletedRecords = await db.prisma().task_log.deleteMany({ where: { task_id: sourceTaskId } });
            logEntries -= deletedRecords.count;
            log
              .atInfo()
              .log(
                `Deleted ${formatNumber(deletedRecords.count)} log entries for source task ${formatNumber(
                  sourceTaskId
                )}. Remaining: ${formatNumber(logEntries)}. Limit ${formatNumber(maxLogEntriesPerSync)}`
              );
            if (logEntries < maxLogEntriesPerSync) {
              log
                .atInfo()
                .log(
                  `Sync ${sync.id} has ${formatNumber(logEntries)} < ${formatNumber(
                    maxLogEntriesPerSync
                  )}. Enough entries deleted`
                );
              //abort stream processing
              return true;
            }
          }
        );
      }
    }
    console.log(
      `Log entries count after cleanup: ${formatNumber(logEntries)}. Size: ${(sizeBytes * Math.pow(10, -9)).toFixed(2)}`
    );

    return Object.fromEntries(
      Object.entries(result).sort(([, e1], [, e2]) => (e2 as any).logEntries - (e1 as any).logEntries)
    );
  })
  .toNextApiHandler();
