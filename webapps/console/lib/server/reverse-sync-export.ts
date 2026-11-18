import { type PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ModelDefinition, ReverseSyncOptions, supportsWarehouseReader } from "@jitsu/warehouse-query/src/schema";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { getServerLog } from "./log";
import { ApiError } from "../shared/errors";
import { retentionConfig, webhookRetentionRefusal } from "./reverse-retention";
import { managedGoogleAudienceForSync } from "./google-audiences";
import {
  GoogleAudienceOptions,
  GoogleAudienceSettings,
} from "@jitsu/destination-functions/src/functions/google-ads/audience/meta";

type ReadDb = Pick<
  Prisma.TransactionClient,
  | "configurationObjectLink"
  | "configurationObject"
  | "source_state"
  | "source_task"
  | "reverse_sync_control"
  | "workspaceOptions"
>;

type Admission = { refreshTaskId?: string; exportPending?: boolean };

/** Paused syncs are omitted unless exporting saved delivery or admitting an explicit refresh. */
export async function readReverseSync(
  db: ReadDb,
  id: string,
  workspaceId?: string,
  admission: Admission = {}
): Promise<ReverseRunConfig | undefined> {
  const snapshot = await readReverseSyncSnapshot(db, id, workspaceId, admission);
  if (!snapshot) return;
  const value = ReverseRunConfig.parse(snapshot);
  serializeReverseConfig(value);
  return value;
}

function serializeReverseConfig(value: ReverseRunConfig): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 900_000)
    throw new ApiError("Reverse configuration exceeds Secret budget", { status: 400 });
  return json;
}

async function readReverseSyncSnapshot(db: ReadDb, id: string, workspaceId: string | undefined, admission: Admission) {
  const link = await db.configurationObjectLink.findFirst({
    where: { id, ...(workspaceId ? { workspaceId } : {}), type: "reverse-sync", deleted: false },
    include: {
      from: { select: { config: true, deleted: true, workspaceId: true, type: true, updatedAt: true } },
      to: { select: { config: true, deleted: true, workspaceId: true, type: true, updatedAt: true } },
      workspace: { select: { deleted: true, featuresEnabled: true, updatedAt: true } },
    },
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
    select: { config: true, updatedAt: true },
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
  // Webhook syncs only (JITSU-242 WP7): the bucket for the stored rows. Deliberately outside the revision hash below.
  const retention = retentionConfig(link.workspaceId, destination);
  // A new run is refused when nothing could be stored for recovery. The desired-state export never refuses (one
  // workspace must not break the export of every sync), and neither does the recovery of a saved run. But an exported
  // schedule becomes a CronJob that starts a run every time it fires, so a sync whose retention forbids new runs is
  // exported without its schedule: it stays in the feed (saved work can still be recovered and refreshed) and stops
  // firing. Scheduling is outside the revision hash, so nothing about saved state changes.
  let noNewRuns = false;
  if (!admission.refreshTaskId) {
    const refusal = await webhookRetentionRefusal(db, link.workspaceId, link.workspace.featuresEnabled, destination);
    if (refusal && !admission.exportPending) throw new ApiError(refusal, { status: 409 });
    noNewRuns = !!refusal;
  }
  // Credentials are intentionally revision-bound in this first runtime slice.
  // Changes require the existing controlled-reset workflow; never recover an old
  // logical run against a different account/query/mapping configuration.
  const {
    schedule: _schedule,
    timezone: _timezone,
    checkpointEvery: _checkpointEvery,
    disabled: _disabled,
    name: _name,
    ...deliveryOptions
  } = options;
  // leaveAsIs/stringify preserve SQL columns and checkpoint identity, so operators
  // may switch between completed runs without resetting state. Pause/drain all
  // dependent syncs before a direct DB edit; this hash no longer detects that switch.
  // Flatten changes mapping field names and stays revision-bound.
  const { nestedObjects, ...originalModel } = model;
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        ...runtime,
        model: nestedObjects === "flatten" ? model : originalModel,
        options: deliveryOptions,
      })
    )
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
  return {
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
    schedule: options.disabled || noNewRuns ? undefined : options.schedule,
    timezone: options.timezone ?? "Etc/UTC",
    ...runtime,
    ...(retention ? { retention } : {}),
  };
}

const log = getServerLog("reverse-sync-export");

async function exportReverseSyncRow(db: PrismaClient, id: string) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    try {
      const snapshot = await db.$transaction(
        tx => readReverseSyncSnapshot(tx, id, undefined, { exportPending: true }),
        {
          isolationLevel: "RepeatableRead",
          timeout: 15_000,
        }
      );
      return snapshot && serializeReverseConfig(ReverseRunConfig.parse(snapshot));
    } catch (error) {
      const expired =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2028" &&
        error.message.includes("expired transaction");
      const retry = expired && attempt === 1;
      const entry = retry ? log.atWarn() : log.atError();
      entry.log(
        `Reverse sync ${id} export attempt ${attempt} failed after ${Date.now() - started} ms; ${
          retry ? "retrying expired transaction" : "aborting export"
        }`
      );
      if (!retry) throw error;
    }
  }
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
      const json = await exportReverseSyncRow(db, row.id);
      if (json) {
        writer.write(`${comma ? "," : ""}${json}`);
        comma = true;
      }
      after = row.id;
    }
  }
  writer.write("]");
}
