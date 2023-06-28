import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { randomId } from "juava";
import { source_taskDbModel } from "../../../../prisma/schema";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

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
      const errorId = randomId();
      console.error(
        `Error loading tasks for sync ids ${body} in workspace ${workspaceId}. Error ID: ${errorId}. Error: ${e}`
      );
      return {
        ok: false,
        error: `couldn't load tasks due to internal server error. Please contact support. Error ID: ${errorId}`,
      };
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
      const tasks = await db.prisma().source_task.findMany({
        where: {
          ...(query.syncId !== "all" && {
            sync_id: {
              equals: query.syncId,
            },
          }),
          ...(query.status && {
            status: {
              equals: query.status,
            },
          }),
          ...((query.from || query.to) && {
            started_at: {
              ...(query.from && {
                gte: dayjs(query.from, "YYYY-MM-DD").utc(true).toDate(),
              }),
              ...(query.to && {
                lt: dayjs(query.to, "YYYY-MM-DD").utc(true).add(1, "d").toDate(),
              }),
            },
          }),
        },
        orderBy: {
          started_at: "desc",
        },
        take: 50,
      });

      return {
        ok: true,
        tasks: tasks,
      };
    } catch (e: any) {
      const errorId = randomId();
      console.error(
        `Error loading tasks for sync ids ${query.syncId} in workspace ${workspaceId}. Error ID: ${errorId}. Error: ${e}`
      );
      return {
        ok: false,
        error: `couldn't load tasks due to internal server error. Please contact support. Error ID: ${errorId}`,
      };
    }
  })
  .toNextApiHandler();
