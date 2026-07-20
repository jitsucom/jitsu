import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { source_taskDbModel } from "../../../../prisma/schema";
import { getAppEndpoint } from "../../../../lib/domains";
import { syncService, latestSyncTaskSchema } from "../../../../lib/server/route-services";

const aggregatedResultType = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  // value shape is owned by the service (latestSyncTaskSchema) so it can't drift from the query
  tasks: z.record(latestSyncTaskSchema).optional(),
});

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

export const route = createRoute()
  .POST({
    auth: true,
    // Semantic read — POST is used so the syncId list can be passed in the body
    // instead of a long query string. No writes. Keep accessible during maintenance.
    allowDuringMaintenance: true,
    summary: "Get latest tasks for syncs",
    description:
      "Given a list of `syncId`s in the body, returns the most recent non-skipped task per sync as a `{ syncId: task }` map. " +
      "Useful for rendering status badges next to many syncs at once.",
    tags: ["sync"],
    query: z.object({
      workspaceId: z.string(),
    }),
    body: z.array(z.string()),
    result: aggregatedResultType,
  })
  .handler(async ({ user, query, body }) => {
    return syncService().latestSyncTasks(user, query.workspaceId, body);
  })
  .GET({
    auth: true,
    summary: "List sync tasks",
    description:
      "Returns up to 50 most recent tasks for a sync, ordered by start time descending. " +
      "Filter with `taskId` (single task — response carries `task` and `logs` URL), `status`, and a `from`/`to` time window. " +
      "Without `taskId` the response carries the `tasks` array.",
    tags: ["sync"],
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
  .handler(async ({ user, query, req }) => {
    const { workspaceId } = query;
    const result = await syncService().listSyncTasks(user, workspaceId, {
      syncId: query.syncId,
      taskId: query.taskId,
      status: query.status,
      from: query.from,
      to: query.to,
    });
    if (result.ok && result.task) {
      result.logs = `${getAppEndpoint(req).baseUrl}/api/${workspaceId}/sources/logs?taskId=${query.taskId}&syncId=${
        query.syncId
      }`;
    }
    return result;
  });

export default route.toNextApiHandler();

export const config = {
  maxDuration: 180, //3 mins, mostly because of workspace-stat call
};
