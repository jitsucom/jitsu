import type { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";
import { z } from "zod";
import { verifyAccessWithRole } from "../api";
import type { SessionUser } from "../schema";
import { ApiError } from "../shared/errors";
import { configObjectAuditLog } from "./audit-log";
import { provisionRetlBucketForSync } from "./reverse-retention";
import { readReverseSync } from "./reverse-sync-export";
import { requestReverseController } from "./reverse-controller";
import { getServerEnv } from "./serverEnv";
import { getServerLog } from "./log";
import {
  createReverseSync,
  updateReverseSync,
  deleteReverseSync,
  listReverseSyncs,
  reverseTasks,
  reverseLogs,
} from "./reverse-syncs";
import { previewModel, modelColumns } from "./reverse-etl-models";
import { PreviewRequest } from "@jitsu/warehouse-query/src/schema";

export const ReverseSyncAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run") }).strict(),
  z.object({ action: z.literal("cancel"), taskId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("refresh"), taskId: z.string().min(1) }).strict(),
]);
export const ReverseTaskFilter = z.object({
  syncId: z.string().optional(),
  taskId: z.string().optional(),
  status: z
    .enum(["COMPLETE", "PENDING", "SUCCESS", "FAILED", "RUNNING", "WAITING", "RESUMED", "CANCELLED", "SKIPPED"])
    .optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/** Shared HTTP/MCP boundary: permissions, provisioning, admission and audit stay identical. */
export class ReverseEtlService {
  constructor(private readonly prisma: PrismaClient) {}

  private querySignal(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(30_000);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  async list(user: SessionUser, workspaceId: string) {
    await verifyAccessWithRole(user, workspaceId, "readEntities");
    return listReverseSyncs(this.prisma, workspaceId);
  }

  async create(user: SessionUser, workspaceId: string, requestId: string, input: unknown, req?: NextApiRequest) {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    const result = await createReverseSync(this.prisma, workspaceId, z.string().uuid().parse(requestId), input);
    await provisionRetlBucketForSync(this.prisma, workspaceId, result.id);
    await configObjectAuditLog(
      user,
      workspaceId,
      result.id,
      "link",
      "create",
      { newVersion: { type: "reverse-sync" } },
      req
    );
    return result;
  }

  async update(user: SessionUser, workspaceId: string, syncId: string, input: unknown, req?: NextApiRequest) {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    const result = await updateReverseSync(this.prisma, workspaceId, syncId, input);
    await provisionRetlBucketForSync(this.prisma, workspaceId, syncId);
    await configObjectAuditLog(user, workspaceId, syncId, "link", "update", { newVersion: input }, req);
    return result;
  }

  async delete(user: SessionUser, workspaceId: string, syncId: string, req?: NextApiRequest) {
    await verifyAccessWithRole(user, workspaceId, "deleteEntities");
    const result = await deleteReverseSync(this.prisma, workspaceId, syncId);
    await configObjectAuditLog(user, workspaceId, syncId, "link", "delete", {}, req);
    return result;
  }

  async tasks(user: SessionUser, workspaceId: string, filter: z.input<typeof ReverseTaskFilter>) {
    await verifyAccessWithRole(user, workspaceId, "readEntities");
    return reverseTasks(this.prisma, workspaceId, ReverseTaskFilter.parse(filter));
  }

  async logs(user: SessionUser, workspaceId: string, syncId: string, taskId: string) {
    await verifyAccessWithRole(user, workspaceId, "readEntities");
    return reverseLogs(this.prisma, workspaceId, syncId, taskId);
  }

  async columns(user: SessionUser, workspaceId: string, modelId: string, signal?: AbortSignal) {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    return modelColumns(this.prisma, workspaceId, modelId, this.querySignal(signal));
  }

  async preview(user: SessionUser, workspaceId: string, input: z.input<typeof PreviewRequest>, signal?: AbortSignal) {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    const body = PreviewRequest.parse(input);
    return previewModel(
      this.prisma,
      workspaceId,
      body.warehouseId,
      body.query,
      this.querySignal(signal),
      body.nestedObjects
    );
  }

  async act(
    user: SessionUser,
    workspaceId: string,
    syncId: string,
    input: z.input<typeof ReverseSyncAction>,
    req?: NextApiRequest
  ) {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    const body = ReverseSyncAction.parse(input);
    const prisma = this.prisma;
    if (body.action !== "run") {
      const tasks = await reverseTasks(prisma, workspaceId, { syncId, taskId: body.taskId });
      if (
        !tasks.length ||
        (body.action === "refresh"
          ? !tasks[0].canRefresh
          : !["RUNNING", "WAITING", "PENDING"].includes(tasks[0].status))
      )
        throw new ApiError(
          body.action === "refresh" ? "No saved run available for a status refresh" : "No active attempt to cancel",
          { status: 409 }
        );
    }
    const config =
      body.action !== "cancel"
        ? await readReverseSync(
            prisma,
            syncId,
            workspaceId,
            body.action === "refresh" ? { refreshTaskId: body.taskId } : {}
          )
        : undefined;
    if (body.action !== "cancel" && !config)
      throw new ApiError(
        body.action === "refresh"
          ? "Saved run is unavailable or its configuration has changed"
          : "Enable the sync before running it",
        { status: 409 }
      );
    if (body.action === "run" && (await prisma.source_task.count({ where: { sync_id: syncId, status: "RUNNING" } })))
      throw new ApiError("This sync is still extracting or submitting uploads", { status: 409 });
    const env = getServerEnv();
    if (!env.SYNCCTL_URL) throw new ApiError("Sync controller is not configured", { status: 503 });
    let result;
    try {
      result = await requestReverseController({
        baseUrl: env.SYNCCTL_URL,
        token: env.SYNCCTL_AUTH_KEY,
        action: body.action,
        query: {
          kind: "reverse",
          workspaceId,
          syncId,
          ...(config ? { updatedAt: config.updatedAt } : {}),
          ...(body.action !== "run" ? { taskId: body.taskId } : {}),
        },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        getServerLog("reverse-controller").atError().log(`${body.action} failed for sync ${syncId}: ${error.message}`);
        throw error;
      }
      throw new ApiError(
        "Sync controller request could not be prepared. Ask your administrator to check SYNCCTL_URL.",
        { status: 503 }
      );
    }
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
      status:
        body.action === "run"
          ? "started"
          : body.action === "refresh"
          ? "status refresh requested"
          : "cancellation requested",
      ...(result.taskId ? { taskId: result.taskId } : {}),
    };
  }
}
