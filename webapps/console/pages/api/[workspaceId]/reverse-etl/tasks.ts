import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseTask } from "../../../../lib/reverse-etl";
import { reverseLogs, reverseTasks } from "../../../../lib/server/reverse-syncs";

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string(), syncId: z.string().optional(), taskId: z.string().optional() }),
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
  .handler(async ({ user, query: { workspaceId, syncId, taskId }, res }) => {
    await verifyAccessWithRole(user, workspaceId, "readEntities");
    res.setHeader("Cache-Control", "no-store");
    const tasks = await reverseTasks(db.prisma(), workspaceId, { syncId, taskId });
    const logs = taskId && tasks.length ? await reverseLogs(db.prisma(), workspaceId, tasks[0].sync_id, taskId) : [];
    return { tasks, logs };
  });
export default route.toNextApiHandler();
