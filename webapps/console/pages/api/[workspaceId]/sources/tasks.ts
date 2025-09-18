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
        description: z.string().nullish(),
        error: z.string().nullish(),
        started_by: z.any().optional(),
        started_at: z.date(),
        updated_at: z.date(),
        metrics: z.any().optional(),
      })
    )
    .optional(),
});

type aggregatedResultType = z.infer<typeof aggregatedResultType>;
type source_task = z.infer<typeof source_taskDbModel>;

//fix the type of started_by and metrics from weird prism type to any
const adjustedSourceTaskDBModel = source_taskDbModel
  .omit({ started_by: true })
  .merge(z.object({ started_by: z.any().optional(), metrics: z.any().optional() }));

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
    const syncs = await db.prisma().configurationObjectLink.findMany({
      where: {
        id: {
          in: body,
        },
        workspaceId: workspaceId,
        deleted: false,
        type: "sync",
      },
    });
    const syncsId = syncs.map(s => s.id);
    try {
      //get latest source_tasks from db for provided sync ids grouped by sync id
      const rows = await db.pgPool().query(
        `select DISTINCT ON (sync_id) sync_id, task_id, status, error, description, started_at, updated_at
         from newjitsu.source_task where sync_id = ANY($1::text[]) and status != 'SKIPPED'
         order by sync_id, started_at desc`,
        [syncsId]
      );
      const tasksRecord = rows.rows.reduce((acc, r) => {
        acc[r.sync_id] = {
          sync_id: r.sync_id,
          task_id: r.task_id,
          status: r.status,
          description: r.description,
          error: r.error,
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
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      status: z.string().optional(),
    }),
    result: tasksResultType,
  })
  .handler(async ({ user, query, req, res }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    const sync = await db.prisma().configurationObjectLink.findFirst({
      where: {
        id: query.syncId,
        workspaceId: workspaceId,
        deleted: false,
        type: "sync",
      },
    });
    if (!sync) {
      return {
        ok: false,
        error: `Sync ${query.syncId} not found`,
      };
    }
    try {
      let i = 1;
      let sql: string =
        'select st.* from newjitsu.source_task st join newjitsu."ConfigurationObjectLink" link on st.sync_id = link.id where link."workspaceId" = $1';
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
        args.push(dayjs(query.from).utc().toDate());
      }
      if (query.to) {
        args.push(dayjs(query.to).utc().toDate());
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
