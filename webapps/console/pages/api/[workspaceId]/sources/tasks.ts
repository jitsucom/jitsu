import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { source_taskDbModel } from "../../../../prisma/schema";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import { getServerLog } from "../../../../lib/server/log";
import { getAppEndpoint } from "../../../../lib/domains";
import { syncError } from "../../../../lib/server/sync";

const log = getServerLog("sync-tasks");

const aggregatedResultType = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  tasks: z
    .record(
      z.object({
        sync_id: z.string(),
        task_id: z.string(),
        status: z.string(),
        description: z.string(),
        started_by: z.any().optional(),
        started_at: z.date(),
        updated_at: z.date(),
      })
    )
    .optional(),
});

type aggregatedResultType = z.infer<typeof aggregatedResultType>;
type source_task = z.infer<typeof source_taskDbModel>;

//fix the type of started_by from weird prism type to any
const adjustedSourceTaskDBModel = source_taskDbModel
  .omit({ started_by: true })
  .merge(z.object({ started_by: z.any().optional() }));

const tasksResultType = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  tasks: z.array(adjustedSourceTaskDBModel).optional(),
  task: adjustedSourceTaskDBModel.optional(),
  logs: z.string().optional(),
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
        `select distinct sync_id as sync_id,
       last_value(task_id) over ( partition by sync_id order by started_at RANGE BETWEEN unbounded preceding and unbounded following) as task_id,
       last_value(status) over ( partition by sync_id order by started_at RANGE BETWEEN unbounded preceding and unbounded following) as status,
       last_value(description) over ( partition by sync_id order by started_at RANGE BETWEEN unbounded preceding and unbounded following) as description,
       last_value(started_at) over ( partition by sync_id order by started_at RANGE BETWEEN unbounded preceding and unbounded following) as started_at,
       last_value(updated_at) over ( partition by sync_id order by started_at RANGE BETWEEN unbounded preceding and unbounded following) as updated_at
from source_task where sync_id = ANY($1::text[])`,
        [body]
      );
      const tasksRecord = rows.rows.reduce((acc, r) => {
        acc[r.sync_id] = {
          sync_id: r.sync_id,
          task_id: r.task_id,
          status: r.status,
          description: r.description,
          started_at: r.started_at,
          updated_at: r.updated_at,
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
      syncId: z.string().optional(),
      taskId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      status: z.string().optional(),
    }),
    result: tasksResultType,
  })
  .handler(async ({ user, query, req }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);

    try {
      let i = 1;
      let sql: string =
        'select st.* from source_task st join "ConfigurationObjectLink" link on st.sync_id = link.id where link."workspaceId" = $1';
      sql += query.syncId ? ` and st.sync_id = $${++i}` : "";
      sql += query.taskId ? ` and st.task_id = $${++i}` : "";
      sql += query.status ? ` and st.status = $${++i}` : "";
      sql += query.from ? ` and st.started_at >= $${++i}` : "";
      sql += query.to ? ` and st.started_at < $${++i}` : "";
      sql += " order by st.started_at desc limit 50";
      log.atDebug().log(`sql: ${sql}`);
      const args: any[] = [workspaceId];
      if (query.syncId) {
        args.push(query.syncId);
      }
      if (query.taskId) {
        args.push(query.taskId);
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
      if (query.taskId) {
        if (tasks.length == 0) {
          return {
            ok: false,
            error: `Task ${query.taskId} not found`,
          };
        } else {
          return {
            ok: true,
            task: tasks[0],
            logs: `${getAppEndpoint(req).baseUrl}/api/${workspaceId}/sources/logs?taskId=${query.taskId}&syncId=${
              query.syncId
            }`,
          };
        }
      } else {
        return {
          ok: true,
          tasks: tasks,
        };
      }
    } catch (e: any) {
      return syncError(log, `Error loading tasks`, e, false, `sync ids: ${query.syncId} workspace: ${workspaceId}`);
    }
  })
  .toNextApiHandler();
