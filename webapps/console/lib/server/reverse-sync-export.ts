import type { PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ModelDefinition, ReverseSyncOptions, supportsWarehouseReader } from "@jitsu/warehouse-query/src/schema";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { ApiError } from "../shared/errors";
import { managedGoogleAudienceForSync } from "./google-audiences";
import {
  GoogleAudienceOptions,
  GoogleAudienceSettings,
} from "@jitsu/destination-functions/src/functions/google-ads/audience/meta";

type ReadDb = Pick<
  Prisma.TransactionClient,
  "configurationObjectLink" | "configurationObject" | "source_state" | "source_task" | "reverse_sync_control"
>;

/** Paused syncs are omitted unless exporting saved delivery or admitting an explicit refresh. */
export async function readReverseSync(
  db: ReadDb,
  id: string,
  workspaceId?: string,
  admission: { refreshTaskId?: string; exportPending?: boolean } = {}
): Promise<ReverseRunConfig | undefined> {
  const link = await db.configurationObjectLink.findFirst({
    where: { id, ...(workspaceId ? { workspaceId } : {}), type: "reverse-sync", deleted: false },
    include: { from: true, to: true, workspace: true },
  });
  if (!link || link.workspace.deleted || !link.workspace.featuresEnabled.includes("reverse-etl")) return;
  const options = ReverseSyncOptions.parse(link.data);
  if (
    (options.disabled && !admission.refreshTaskId && !admission.exportPending) ||
    link.from.deleted ||
    link.to.deleted
  )
    return;
  if (
    options.disabled &&
    admission.exportPending &&
    !(await db.reverse_sync_control.findFirst({
      where: { workspace_id: link.workspaceId, sync_id: id, phase: { notIn: ["complete", "aborted"] } },
      select: { run_id: true },
    }))
  )
    return;
  if (
    link.from.workspaceId !== link.workspaceId ||
    link.to.workspaceId !== link.workspaceId ||
    link.from.type !== "model" ||
    link.to.type !== "destination"
  )
    throw new ApiError("Invalid reverse sync references", { status: 409 });
  const model = ModelDefinition.parse(link.from.config);
  const warehouse = await db.configurationObject.findFirst({
    where: { id: model.warehouseId, workspaceId: link.workspaceId, type: "destination", deleted: false },
  });
  if (!warehouse || !supportsWarehouseReader(warehouse.config as Record<string, unknown>))
    throw new ApiError("Reverse warehouse is missing or unsupported", { status: 409 });
  const destination = { ...(link.to.config as Record<string, unknown>) };
  // This field is server evidence, never editable destination configuration.
  delete destination.reverseManagedAudience;
  if (destination.destinationType === "google-ads" && options.stream === "audience") {
    const replacement = options.streamOptions.mirrorStrategy === "full-replace";
    // Existing admission also serves disabled, not-yet-provisioned setups. Only
    // native replacement needs this additional destructive-mode confirmation.
    const runtimeProvisioned = options.streamOptions.audience !== undefined;
    if (runtimeProvisioned) GoogleAudienceSettings.parse(options.streamOptions);
    else if (replacement) GoogleAudienceOptions.parse(options.streamOptions);
    if (replacement && options.mode !== "mirror")
      throw new ApiError("Full replacement requires mirror mode", { status: 409 });
    if (!runtimeProvisioned && (options.mode === "mirror" || options.streamOptions.managedAudienceId !== undefined)) {
      const managed = await managedGoogleAudienceForSync(
        db,
        link.workspaceId,
        link.toId,
        link.id,
        options.streamOptions,
        destination
      );
      if (options.mode === "mirror" && !managed && !replacement)
        throw new ApiError("Google mirror requires a Jitsu-managed audience", { status: 409 });
      if (managed) destination.reverseManagedAudience = managed;
    }
  }
  const runtime = { model, warehouse: warehouse.config, destination, options };
  // Credentials are intentionally revision-bound in this first runtime slice.
  // Changes require the existing controlled-reset workflow; never recover an old
  // logical run against a different account/query/normalization configuration.
  const {
    schedule: _schedule,
    timezone: _timezone,
    checkpointEvery: _checkpointEvery,
    disabled: _disabled,
    name: _name,
    ...deliveryOptions
  } = options;
  const revision = createHash("sha256")
    .update(JSON.stringify({ ...runtime, options: deliveryOptions }))
    .digest("hex");
  // A pause is not permission to start new work. Only retain configurations for
  // existing nonterminal delivery, and bind explicit refresh/OAuth to its task.
  if (admission.refreshTaskId || options.disabled) {
    let runId: string | undefined;
    if (admission.refreshTaskId) {
      const task = await db.source_task.findFirst({
        where: {
          sync_id: id,
          task_id: admission.refreshTaskId,
          package: "jitsu/retl-runner",
          status: { in: ["WAITING", "PENDING", "FAILED", "CANCELLED"] },
        },
        select: { metrics: true, started_by: true },
      });
      const recovery = (task?.metrics as { reverseRecovery?: { runId?: string; revision?: string } } | null)
        ?.reverseRecovery;
      if (
        (task?.started_by as { workspaceId?: string } | null)?.workspaceId !== link.workspaceId ||
        typeof recovery?.runId !== "string" ||
        recovery.revision !== revision
      )
        return;
      runId = recovery.runId;
    }
    const control = await db.reverse_sync_control.findFirst({
      where: {
        workspace_id: link.workspaceId,
        sync_id: id,
        revision,
        ...(runId ? { run_id: runId } : {}),
        phase: { notIn: ["complete", "aborted"] },
      },
      select: { run_id: true },
    });
    if (!control) return;
  }
  const value = ReverseRunConfig.parse({
    version: 1,
    kind: "reverse",
    id: link.id,
    workspaceId: link.workspaceId,
    fromId: link.fromId,
    toId: link.toId,
    configRevision: revision,
    updatedAt: new Date(
      Math.max(
        +link.updatedAt,
        +link.from.updatedAt,
        +link.to.updatedAt,
        +warehouse.updatedAt,
        +link.workspace.updatedAt
      )
    ).toISOString(),
    schedule: options.disabled ? undefined : options.schedule,
    timezone: options.timezone ?? "Etc/UTC",
    ...runtime,
  });
  if (Buffer.byteLength(JSON.stringify(value)) > 900_000)
    throw new ApiError("Reverse configuration exceeds Secret budget", { status: 400 });
  return value;
}

export async function exportReverseSyncs(db: PrismaClient, writer: { write(chunk: string): unknown }) {
  writer.write("[");
  let after: string | undefined;
  let comma = false;
  for (;;) {
    const rows: { id: string }[] = await db.configurationObjectLink.findMany({
      where: { type: "reverse-sync", deleted: false, ...(after ? { id: { gt: after } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (!rows.length) break;
    for (const row of rows) {
      const config = await db.$transaction(tx => readReverseSync(tx, row.id, undefined, { exportPending: true }), {
        isolationLevel: "RepeatableRead",
      });
      if (config) {
        writer.write(`${comma ? "," : ""}${JSON.stringify(config)}`);
        comma = true;
      }
      after = row.id;
    }
  }
  writer.write("]");
}
