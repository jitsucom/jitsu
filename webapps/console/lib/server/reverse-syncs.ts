import { z } from "zod";
import type { PrismaClient, Prisma } from "@prisma/client";
import { ModelDefinition, ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import { ReverseSyncInput, ReverseSyncSettings, ReverseSyncView, ReverseTask } from "../reverse-etl";
import { ReverseDeliveryStats } from "@jitsu/protocols/reverse-etl-stats";
import { ApiError } from "../shared/errors";
import { assertModelsEnabled } from "./reverse-etl-models";
import { validateSyncSchedule } from "./sync";

type ReadDb = Prisma.TransactionClient;
const missing = () => new ApiError("Reverse sync not found in this workspace", { status: 404 });
const conflict = (message: string) => new ApiError(message, { status: 409 });
const taskSelect = {
  task_id: true,
  sync_id: true,
  status: true,
  started_at: true,
  updated_at: true,
  description: true,
  error: true,
  metrics: true,
  started_by: true,
} as const;
function taskView(task: Prisma.source_taskGetPayload<{ select: typeof taskSelect }>) {
  const metrics = task.metrics as Record<string, unknown> | null;
  const startedBy = task.started_by as Record<string, unknown> | null;
  const stats = ReverseDeliveryStats.safeParse(metrics?.reverseDelivery);
  const trigger = z.enum(["manual", "scheduled", "recovery"]).safeParse(startedBy?.trigger);
  return ReverseTask.parse({
    ...task,
    stats: stats.success ? stats.data : null,
    trigger: trigger.success ? trigger.data : null,
  });
}
async function mutation<T>(prisma: PrismaClient, workspaceId: string, write: (tx: ReadDb) => Promise<T>) {
  return prisma.$transaction(
    async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`retl-models:${workspaceId}`}, 0))`;
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR SHARE`;
      return write(tx);
    },
    { timeout: 30_000 }
  );
}
async function linkFor(db: ReadDb, workspaceId: string, id: string) {
  const link = await db.configurationObjectLink.findFirst({
    where: { id, workspaceId, type: "reverse-sync", deleted: false },
  });
  if (!link) throw missing();
  return link;
}
function schedule(input: { schedule?: string; timezone?: string }) {
  if (
    input.schedule?.startsWith("@") &&
    !["@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"].includes(input.schedule)
  )
    throw conflict("Use a five-field cron expression or supported Kubernetes schedule");
  if (input.schedule && !input.schedule.startsWith("@") && input.schedule.trim().split(/\s+/).length !== 5)
    throw conflict("Schedule must have five cron fields");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone || "Etc/UTC" });
    validateSyncSchedule(input);
  } catch {
    throw conflict("Invalid cron schedule or IANA timezone");
  }
}
/** Save never queries a warehouse, OAuth or Google. */
async function references(db: ReadDb, workspaceId: string, input: ReverseSyncInput) {
  await assertModelsEnabled(db, workspaceId);
  const model = await db.configurationObject.findFirst({
    where: { id: input.fromId, workspaceId, type: "model", deleted: false },
  });
  const destination = await db.configurationObject.findFirst({
    where: { id: input.toId, workspaceId, type: "destination", deleted: false },
  });
  if (!model || !destination) throw conflict("Choose a model and destination in this workspace");
  const definition = ModelDefinition.parse(model.config);
  const provider = reverseDestinationMetadata.get((destination.config as any).destinationType);
  if (!provider || !provider.streams.some(stream => stream.id === input.data.stream))
    throw conflict("This destination stream is not supported");
  try {
    provider.validateSettings(input.data, definition);
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw conflict(error instanceof Error ? error.message : "Invalid destination settings");
  }
  schedule(input.data);
}
function delivery(input: ReverseSyncInput) {
  const { name, schedule, timezone, disabled, checkpointEvery, ...data } = input.data;
  return contentHash({ fromId: input.fromId, toId: input.toId, data });
}
async function hasState(db: ReadDb, workspaceId: string, syncId: string) {
  return (
    !!(await db.reverse_sync_control.findFirst({
      where: { workspace_id: workspaceId, sync_id: syncId },
      select: { sync_id: true },
    })) ||
    !!(await db.source_state.findFirst({
      where: { sync_id: syncId, stream: "_REVERSE_ETL_GOOGLE_AUDIENCE_" },
      select: { sync_id: true },
    })) ||
    !!(await db.source_task.findFirst({
      where: { sync_id: syncId, status: { in: ["RUNNING", "WAITING", "PENDING"] } },
      select: { task_id: true },
    }))
  );
}
export async function createReverseSync(prisma: PrismaClient, workspaceId: string, requestId: string, raw: unknown) {
  z.string().uuid().parse(requestId);
  const input = ReverseSyncInput.parse(raw);
  const id = `retl-${contentHash([workspaceId, requestId]).slice(0, 32)}`;
  return mutation(prisma, workspaceId, async tx => {
    await assertModelsEnabled(tx, workspaceId);
    const existing = await tx.configurationObjectLink.findFirst({ where: { id, workspaceId, type: "reverse-sync" } });
    if (existing) {
      if (
        existing.deleted ||
        existing.fromId !== input.fromId ||
        existing.toId !== input.toId ||
        contentHash(existing.data) !== contentHash(input.data)
      )
        throw conflict("This save already created a sync with different settings; reload the saved sync");
      return { id };
    }
    await references(tx, workspaceId, input);
    await tx.configurationObjectLink.create({
      data: {
        id,
        workspaceId,
        type: "reverse-sync",
        fromId: input.fromId,
        toId: input.toId,
        data: input.data as Prisma.InputJsonObject,
      },
    });
    return { id };
  });
}
export async function updateReverseSync(prisma: PrismaClient, workspaceId: string, syncId: string, raw: unknown) {
  const input = z.union([ReverseSyncInput, ReverseSyncSettings]).parse(raw);
  return mutation(prisma, workspaceId, async tx => {
    const link = await linkFor(tx, workspaceId, syncId);
    const old = { fromId: link.fromId, toId: link.toId, data: ReverseSyncOptions.parse(link.data) };
    const full = "data" in input;
    const next = full ? input : { ...old, data: { ...old.data, ...input } };
    const changed = delivery(next) !== delivery(old);
    if (!(Object.keys(input).length === 1 && "disabled" in input && input.disabled === true)) {
      await assertModelsEnabled(tx, workspaceId);
      if (changed) await references(tx, workspaceId, next);
      schedule(next.data);
    }
    if (changed && (await hasState(tx, workspaceId, syncId)))
      throw conflict(
        "Delivery settings are locked after a run starts. Create a new sync to change its model, destination or stream settings."
      );
    await tx.configurationObjectLink.update({
      where: { id: syncId },
      data: { fromId: next.fromId, toId: next.toId, data: next.data as Prisma.InputJsonObject },
    });
    return { id: syncId };
  });
}
export async function deleteReverseSync(prisma: PrismaClient, workspaceId: string, syncId: string) {
  return mutation(prisma, workspaceId, async tx => {
    const link = await linkFor(tx, workspaceId, syncId);
    if (!ReverseSyncOptions.parse(link.data).disabled) throw conflict("Pause this sync before deleting it");
    if (await tx.source_task.count({ where: { sync_id: syncId, status: { in: ["RUNNING", "WAITING", "PENDING"] } } }))
      throw conflict("Cancel active or waiting attempts before deleting this sync");
    await tx.configurationObjectLink.update({ where: { id: syncId }, data: { deleted: true } });
    // Deletion keeps runtime state and never clears Google.
    return { id: syncId };
  });
}
export async function listReverseSyncs(prisma: PrismaClient, workspaceId: string) {
  const links = await prisma.configurationObjectLink.findMany({
    where: { workspaceId, type: "reverse-sync", deleted: false },
    include: { from: true, to: true },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(
    links.map(async link => {
      const latestTask = await prisma.source_task.findFirst({
        where: { sync_id: link.id, package: "jitsu/retl-runner" },
        orderBy: { started_at: "desc" },
        select: taskSelect,
      });
      const control = await prisma.reverse_sync_control.findFirst({
        where: { workspace_id: workspaceId, sync_id: link.id },
        orderBy: { run_order: "desc" },
        select: { phase: true },
      });
      return ReverseSyncView.parse({
        id: link.id,
        fromId: link.fromId,
        toId: link.toId,
        modelName: (link.from.config as any).name || link.from.id,
        destinationName: (link.to.config as any).name || link.to.id,
        options: link.data,
        settingsLocked: await hasState(prisma, workspaceId, link.id),
        latestTask: latestTask ? taskView(latestTask) : null,
        phase: control?.phase ?? null,
      });
    })
  );
}
export async function reverseTasks(
  prisma: PrismaClient,
  workspaceId: string,
  filter: { syncId?: string; taskId?: string; status?: string; from?: string; to?: string }
) {
  const links = await prisma.configurationObjectLink.findMany({
    where: { workspaceId, type: "reverse-sync", ...(filter.syncId ? { id: filter.syncId } : {}) },
    select: { id: true },
  });
  const tasks = await prisma.source_task.findMany({
    where: {
      sync_id: { in: links.map(l => l.id) },
      package: "jitsu/retl-runner",
      ...(filter.taskId ? { task_id: filter.taskId } : {}),
      ...(filter.status
        ? {
            status: {
              in:
                filter.status === "PENDING"
                  ? ["PENDING", "WAITING"]
                  : filter.status === "COMPLETE"
                  ? ["COMPLETE", "SUCCESS"]
                  : [filter.status],
            },
          }
        : {}),
      ...(filter.from || filter.to
        ? {
            started_at: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          }
        : {}),
    },
    select: taskSelect,
    orderBy: { started_at: "desc" },
    take: 100,
  });
  return tasks.map(taskView);
}
export async function reverseLogs(prisma: PrismaClient, workspaceId: string, syncId: string, taskId: string) {
  if (!(await reverseTasks(prisma, workspaceId, { syncId, taskId })).length) throw missing();
  // Reverse runner owns its diagnostic messages in Postgres. Do not expose receipts or row payloads.
  return prisma.task_log.findMany({
    where: { sync_id: syncId, task_id: taskId, logger: "retl-runner" },
    select: { id: true, timestamp: true, level: true, message: true },
    orderBy: { timestamp: "desc" },
    take: 500,
  });
}
