import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseTask } from "../../../../lib/reverse-etl";
import { ReverseEtlService } from "../../../../lib/server/reverse-etl-service";

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string().optional(),
      taskId: z.string().optional(),
      status: z
        .enum(["COMPLETE", "PENDING", "SUCCESS", "FAILED", "RUNNING", "WAITING", "RESUMED", "CANCELLED", "SKIPPED"])
        .optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }),
    result: z.object({
      tasks: z.array(ReverseTask),
      logs: z.array(
        z.object({
          id: z.string(),
          timestamp: z.coerce.date(),
          level: z.string(),
          message: z.string(),
        })
      ),
    }),
  })
  .handler(async ({ user, query: { workspaceId, ...filter }, res }) => {
    const service = new ReverseEtlService(db.prisma());
    res.setHeader("Cache-Control", "no-store");
    const { taskId } = filter;
    const tasks = await service.tasks(user, workspaceId, filter);
    const logs = taskId && tasks.length ? await service.logs(user, workspaceId, tasks[0].sync_id, taskId) : [];
    return { tasks, logs };
  });
export default route.toNextApiHandler();
