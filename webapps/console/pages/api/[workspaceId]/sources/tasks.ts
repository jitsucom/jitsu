import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { source_taskDbModel } from "../../../../prisma/schema";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { syncError } from "../../../../lib/shared/errors";
import { getServerLog } from "../../../../lib/server/log";
dayjs.extend(utc);

const log = getServerLog("sync-tasks");

const aggregatedResultType = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  tasks: z
    .record(
      z.object({
        syncId: z.string(),
        taskId: z.string(),
        status: z.string(),
        startedAt: z.date(),
        updatedAt: z.date(),
      })
    )
    .optional(),
});

type aggregatedResultType = z.infer<typeof aggregatedResultType>;
type source_task = z.infer<typeof source_taskDbModel>;

const tasksResultType = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  tasks: z.array(source_taskDbModel).optional(),
});

export default createRoute()
  .POST({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
    }),
    body: z.array(z.string()),
    result: aggregatedResultType,
  })
  .handler(async ({ user, query, body }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    try {
      //get latest source_tasks from db for provided sync ids grouped by sync id
      const rows = await db.pgPool().query(
        `select distinct sync_id as syncid,
       last_value(task_id) over ( partition by sync_id order by started_at RANGE BETWEEN unbounded preceding and unbounded following) taskid,
       last_value(status) over ( partition by sync_id order by started_at RANGE BETWEEN unbounded preceding and unbounded following) status,
       last_value(started_at) over ( partition by sync_id order by started_at RANGE BETWEEN unbounded preceding and unbounded following) startedat,
       last_value(updated_at) over ( partition by sync_id order by started_at RANGE BETWEEN unbounded preceding and unbounded following) updatedat
from source_task where sync_id = ANY($1::text[])`,
        [body]
      );
      const tasksRecord = rows.rows.reduce((acc, r) => {
        acc[r.syncid] = {
          syncId: r.syncid,
          taskId: r.taskid,
          status: r.status,
          startedAt: r.startedat,
          updatedAt: r.updatedat,
        };
        return acc;
      }, {} as aggregatedResultType["tasks"]);
      return {
        ok: true,
        tasks: tasksRecord,
      };
    } catch (e: any) {
      return syncError(log, `Error loading tasks`, e, false, `sync ids: ${body} workspace: ${workspaceId}`);
    }
  })
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
      from: z.string().optional(),
      to: z.string().optional(),
      status: z.string().optional(),
    }),
    result: tasksResultType,
  })
  .handler(async ({ user, query }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);

    try {
      let i = 1;
      let sql: string =
        'select st.* from source_task st join "ConfigurationObjectLink" link on st.sync_id = link.id where link."workspaceId" = $1';
      sql += query.syncId !== "all" ? ` and st.sync_id = $${++i}` : "";
      sql += query.status ? ` and st.status = $${++i}` : "";
      sql += query.from ? ` and st.started_at >= $${++i}` : "";
      sql += query.to ? ` and st.started_at < $${++i}` : "";
      sql += " order by st.started_at desc limit 50";
      log.atDebug().log(`sql: ${sql}`);
      const args: any[] = [workspaceId];
      if (query.syncId !== "all") {
        args.push(query.syncId);
      }
      if (query.status) {
        args.push(query.status);
      }
      if (query.from) {
        args.push(dayjs(query.from, "YYYY-MM-DD").utc(true).toDate());
      }
      if (query.to) {
        args.push(dayjs(query.to, "YYYY-MM-DD").utc(true).add(1, "d").toDate());
      }
      const tasks = await db.prisma().$queryRawUnsafe<source_task[]>(sql, ...args);
      return {
        ok: true,
        tasks: tasks,
      };
    } catch (e: any) {
      return syncError(log, `Error loading tasks`, e, false, `sync ids: ${query.syncId} workspace: ${workspaceId}`);
    }
  })
  .toNextApiHandler();
