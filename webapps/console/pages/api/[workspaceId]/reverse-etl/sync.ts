import { z } from "zod";
import { rpc } from "juava";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ReverseSyncSettings, ReverseSyncInput } from "../../../../lib/reverse-etl";
import { updateReverseSync, deleteReverseSync, reverseTasks } from "../../../../lib/server/reverse-syncs";
import { readReverseSync } from "../../../../lib/server/reverse-sync-export";
import { getServerEnv } from "../../../../lib/server/serverEnv";
import { ApiError } from "../../../../lib/shared/errors";
import { configObjectAuditLog } from "../../../../lib/server/audit-log";

const query = z.object({ workspaceId: z.string(), syncId: z.string() });
export const route = createRoute()
  .PUT({
    auth: true,
    mutates: true,
    query,
    body: z.union([ReverseSyncInput, ReverseSyncSettings]),
    result: z.object({ id: z.string() }),
  })
  .handler(async ({ user, query: { workspaceId, syncId }, body, req }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    const result = await updateReverseSync(db.prisma(), workspaceId, syncId, body);
    await configObjectAuditLog(user, workspaceId, syncId, "link", "update", { newVersion: body }, req);
    return result;
  })
  .DELETE({ auth: true, mutates: true, query, result: z.object({ id: z.string() }) })
  .handler(async ({ user, query: { workspaceId, syncId }, req }) => {
    await verifyAccessWithRole(user, workspaceId, "deleteEntities");
    const result = await deleteReverseSync(db.prisma(), workspaceId, syncId);
    await configObjectAuditLog(user, workspaceId, syncId, "link", "delete", {}, req);
    return result;
  })
  .POST({
    auth: true,
    mutates: true,
    query,
    body: z.discriminatedUnion("action", [
      z.object({ action: z.literal("run") }).strict(),
      z.object({ action: z.literal("cancel"), taskId: z.string() }).strict(),
    ]),
    result: z.object({ status: z.string(), taskId: z.string().optional() }),
  })
  .handler(async ({ user, query: { workspaceId, syncId }, body, req, res }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    const prisma = db.prisma();
    if (body.action === "cancel") {
      const tasks = await reverseTasks(prisma, workspaceId, { syncId, taskId: body.taskId });
      if (!tasks.length || !["RUNNING", "WAITING", "PENDING"].includes(tasks[0].status))
        throw new ApiError("No active attempt to cancel", { status: 409 });
    }
    const config = body.action === "run" ? await readReverseSync(prisma, syncId, workspaceId) : undefined;
    if (body.action === "run") {
      if (!config) throw new ApiError("Enable the sync before running it", { status: 409 });
      if (await prisma.source_task.count({ where: { sync_id: syncId, status: "RUNNING" } }))
        throw new ApiError("This sync is still extracting or submitting uploads", { status: 409 });
    }
    const env = getServerEnv();
    if (!env.SYNCCTL_URL) throw new ApiError("Sync controller is not configured", { status: 503 });
    let result;
    try {
      result = await rpc(`${env.SYNCCTL_URL}/${body.action === "run" ? "read" : "cancel"}`, {
        method: body.action === "run" ? "POST" : "GET",
        headers: env.SYNCCTL_AUTH_KEY ? { Authorization: `Bearer ${env.SYNCCTL_AUTH_KEY}` } : {},
        query: {
          kind: "reverse",
          workspaceId,
          syncId,
          ...(config ? { updatedAt: config.updatedAt } : {}),
          ...(body.action === "cancel" ? { taskId: body.taskId } : {}),
        },
      });
    } catch {
      throw new ApiError("Controller response unavailable. Check attempts before retrying.", { status: 503 });
    }
    if (!result.ok)
      throw new ApiError("Controller could not confirm the operation. Check attempts before retrying.", {
        status: 409,
      });
    await configObjectAuditLog(
      user,
      workspaceId,
      syncId,
      "link",
      "update",
      { newVersion: { action: body.action, taskId: result.taskId } },
      req
    );
    return {
      status: body.action === "run" ? "started" : "cancellation requested",
      ...(result.taskId ? { taskId: result.taskId } : {}),
    };
  });
export default route.toNextApiHandler();
