import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient, Prisma } from "@prisma/client";
import { ModelDefinition, ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";
import { validateReverseEtlConfig } from "@jitsu/destination-functions/src/reverse-etl/meta";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import {
  googleAudienceMetadata,
  GoogleAudienceCredentials,
} from "@jitsu/destination-functions/src/functions/google-ads-reverse/meta";
import { createGoogleDataManager } from "@jitsu/destination-functions/src/functions/google-ads-reverse";
import { createGoogleAudienceManagement } from "@jitsu/destination-functions/src/functions/google-ads-reverse/audiences";
import { ReverseSyncSetup, ReverseSyncSettings, ReverseSyncView } from "../reverse-etl";
import { ApiError } from "../shared/errors";
import { assertModelsEnabled, previewModel } from "./reverse-etl-models";
import { provisionGoogleAudience } from "./google-audiences";
import { readGoogleAudienceConnectionToken } from "./google-audience-oauth";
import { nangoConfig, NangoConfig } from "./oauth/nango-config";
import { validateSyncSchedule } from "./sync";
import { readReverseSync } from "./reverse-sync-export";

const setupType = "reverse-sync-setup";
const SetupRecord = z.object({
  input: ReverseSyncSetup,
  requestId: z.string().uuid(),
  syncId: z.string(),
  binding: z.string(),
  ready: z.boolean(),
  audienceName: z.string().optional(),
});
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
} as const;

// Same lock as model/destination mutations: references cannot change between validation and commit.
async function mutation<T>(prisma: PrismaClient, workspaceId: string, write: (tx: ReadDb) => Promise<T>) {
  return prisma.$transaction(
    async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`retl-models:${workspaceId}`}, 0))`;
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR SHARE`;
      return write(tx);
    },
    // Locked reference/admission checks need several DB round trips. Prisma's 5s
    // default can expire on a remote DB; keep a bounded budget for these writes.
    // Warehouse previews and Google requests must remain outside this transaction.
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
async function sourceFor(db: ReadDb, workspaceId: string, input: ReverseSyncSetup) {
  await assertModelsEnabled(db, workspaceId);
  const model = await db.configurationObject.findFirst({
    where: { id: input.modelId, workspaceId, type: "model", deleted: false },
  });
  const destination = await db.configurationObject.findFirst({
    where: { id: input.destinationId, workspaceId, type: "destination", deleted: false },
  });
  if (!model || !destination) throw conflict("Choose an existing model and Google Ads destination in this workspace");
  const definition = ModelDefinition.parse(model.config);
  const credentials = GoogleAudienceCredentials.safeParse(destination.config);
  if (
    (destination.config as any).destinationType !== "google-ads" ||
    !credentials.success ||
    credentials.data.oauthConnectionId !== `destination.${destination.id}`
  )
    throw conflict("Connect this Google Ads destination with Data Manager OAuth before creating a sync");
  if (input.audience.kind === "managed" && (definition.cursor || definition.deleteColumn))
    throw conflict("Mirror requires a full-query model without a cursor or delete column");
  const warehouse = await db.configurationObject.findFirst({
    where: { id: definition.warehouseId, workspaceId, type: "destination", deleted: false },
  });
  if (!warehouse) throw conflict("Model warehouse is unavailable");
  return {
    model: definition,
    credentials: credentials.data,
    binding: contentHash([model.config, destination.config, warehouse.config]),
  };
}
function optionsFor(input: ReverseSyncSetup, streamOptions: Record<string, unknown> = {}) {
  return ReverseSyncOptions.parse({
    name: input.name,
    stream: "audience",
    mode: input.audience.kind === "managed" ? "mirror" : "upsert",
    mapping: input.mapping,
    streamOptions,
    schedule: input.schedule,
    timezone: input.timezone,
    disabled: true,
  });
}
function schedule(input: { schedule?: string; timezone?: string }) {
  if (
    input.schedule?.startsWith("@") &&
    !["@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"].includes(input.schedule)
  )
    throw new ApiError("Use a five-field cron expression or a supported Kubernetes schedule", { status: 400 });
  // Kubernetes cron uses five fields (cron-parser also accepts a seconds field).
  if (input.schedule && !input.schedule.startsWith("@") && input.schedule.trim().split(/\s+/).length !== 5)
    throw new ApiError("Schedule must have five cron fields", { status: 400 });
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone || "Etc/UTC" });
    validateSyncSchedule(input);
  } catch {
    throw new ApiError("Invalid cron schedule or IANA timezone", { status: 400 });
  }
}

/** Bounded read-only preview. Errors describe fields/row indices, never source values. */
export async function validateReverseSetup(
  prisma: PrismaClient,
  workspaceId: string,
  raw: unknown,
  nango: NangoConfig = nangoConfig
) {
  const input = ReverseSyncSetup.parse(raw);
  schedule(input);
  const source = await sourceFor(prisma, workspaceId, input);
  const preview = await previewModel(prisma, workspaceId, source.model.warehouseId, source.model.query);
  const options = optionsFor(input, {
    audienceId: input.audience.kind === "existing" ? input.audience.audienceId : "1",
    customerMatchTermsAccepted: true,
  });
  try {
    validateReverseEtlConfig(googleAudienceMetadata, {
      ...source.model,
      ...options,
      columns: preview.columns.map(c => c.name),
      options: options.streamOptions,
    });
    if (!["email", "phone", "hashedEmail", "hashedPhone"].some(key => input.mapping[key]))
      throw new Error("Map at least one email or phone identifier");
    preview.rows.forEach((row, index) => {
      const mapped = Object.fromEntries(Object.entries(input.mapping).map(([key, column]) => [key, row[column]]));
      const remove = source.model.deleteColumn && [true, 1, "1"].includes(row[source.model.deleteColumn] as any);
      try {
        const stream = createGoogleDataManager(async () => {
          throw new Error("Preview cannot request a token");
        }).stream;
        (remove ? stream.removeRowType! : stream.rowType).parse(mapped);
      } catch {
        throw new Error(
          `Preview row ${
            index + 1
          } has invalid identifiers or consent. Mapped consent fields must contain GRANTED for additions; unmapped consent defaults to GRANTED.`
        );
      }
    });
  } catch (error) {
    throw new ApiError((error as Error).message, { status: 400 });
  }
  const token = await readGoogleAudienceConnectionToken(source.credentials.oauthConnectionId, nango);
  let audienceName: string | undefined;
  if (input.audience.kind === "existing") {
    try {
      audienceName = (
        await createGoogleAudienceManagement(source.credentials, async () => token.accessToken).verifyExisting(
          input.audience.audienceId,
          AbortSignal.timeout(30_000)
        )
      ).displayName;
    } catch {
      throw conflict(
        "Google audience is unavailable, closed, read-only or not a first-party Customer Match audience owned by this account"
      );
    }
  }
  return { binding: source.binding, columns: preview.columns, sampleRows: preview.rows.length, audienceName };
}

/** A client request key only deduplicates local creation; sync IDs are always server generated. */
export async function createReverseSync(
  prisma: PrismaClient,
  workspaceId: string,
  requestId: string,
  raw: unknown,
  nango: NangoConfig = nangoConfig
) {
  z.string().uuid().parse(requestId);
  const input = ReverseSyncSetup.parse(raw);
  const id = `retl-setup-${contentHash([workspaceId, requestId])}`;
  const existing = await prisma.configurationObject.findFirst({ where: { id, workspaceId, type: setupType } });
  if (existing) {
    if ((existing.config as { cancelled?: boolean }).cancelled)
      throw conflict("Creation request was discarded; start a new request");
    const record = SetupRecord.parse(existing.config);
    if (contentHash(record.input) !== contentHash(input))
      throw conflict("Creation request already used with different settings");
    await linkFor(prisma, workspaceId, record.syncId);
    return { id: record.syncId };
  }
  const checked = await validateReverseSetup(prisma, workspaceId, input, nango);
  return mutation(prisma, workspaceId, async tx => {
    const source = await sourceFor(tx, workspaceId, input);
    if (source.binding !== checked.binding)
      throw conflict("Model or destination changed during validation. Try again.");
    const duplicate = await tx.configurationObject.findFirst({ where: { id, workspaceId, type: setupType } });
    if (duplicate) {
      if ((duplicate.config as { cancelled?: boolean }).cancelled)
        throw conflict("Creation request was discarded; start a new request");
      const record = SetupRecord.parse(duplicate.config);
      if (contentHash(record.input) !== contentHash(input)) throw conflict("Creation request already used");
      await linkFor(tx, workspaceId, record.syncId);
      return { id: record.syncId };
    }
    const syncId = `retl-${randomUUID()}`;
    const ready = input.audience.kind === "existing";
    await tx.configurationObjectLink.create({
      data: {
        id: syncId,
        workspaceId,
        fromId: input.modelId,
        toId: input.destinationId,
        type: "reverse-sync",
        data: optionsFor(
          input,
          ready
            ? { audienceId: (input.audience as { audienceId: string }).audienceId, customerMatchTermsAccepted: true }
            : {}
        ) as Prisma.InputJsonObject,
      },
    });
    await tx.configurationObject.create({
      data: {
        id,
        workspaceId,
        type: setupType,
        config: {
          input,
          syncId,
          requestId: randomUUID(),
          binding: source.binding,
          ready,
          ...(checked.audienceName ? { audienceName: checked.audienceName } : {}),
        },
      },
    });
    return { id: syncId };
  });
}
/** Fence an unsaved request against late/concurrent saves before allowing corrected input. */
export async function discardReverseCreation(prisma: PrismaClient, workspaceId: string, requestId: string) {
  z.string().uuid().parse(requestId);
  const id = `retl-setup-${contentHash([workspaceId, requestId])}`;
  return mutation(prisma, workspaceId, async tx => {
    const existing = await tx.configurationObject.findFirst({ where: { id, workspaceId, type: setupType } });
    if (existing && !(existing.config as { cancelled?: boolean }).cancelled) {
      const record = SetupRecord.parse(existing.config);
      // A committed response may have been lost. Do not delete that sync or let this key create another.
      return { status: "saved" as const, id: record.syncId };
    }
    if (!existing)
      await tx.configurationObject.create({ data: { id, workspaceId, type: setupType, config: { cancelled: true } } });
    return { status: "discarded" as const };
  });
}

async function setupFor(db: ReadDb, workspaceId: string, syncId: string) {
  const row = await db.configurationObject.findFirst({
    where: { workspaceId, type: setupType, deleted: false, config: { path: ["syncId"], equals: syncId } },
  });
  return row ? { row, record: SetupRecord.parse(row.config) } : undefined;
}
export async function completeReverseSetup(
  prisma: PrismaClient,
  workspaceId: string,
  syncId: string,
  nango: NangoConfig = nangoConfig
) {
  await linkFor(prisma, workspaceId, syncId);
  const setup = await setupFor(prisma, workspaceId, syncId);
  if (!setup) throw conflict("No saved setup exists for this sync");
  if (setup.record.ready) return { status: "ready" as const };
  const { input, binding, requestId } = setup.record;
  if (input.audience.kind !== "managed") throw conflict("Invalid setup");
  if ((await sourceFor(prisma, workspaceId, input)).binding !== binding)
    throw conflict("Model or destination changed; setup cannot be rebound");
  const result = await provisionGoogleAudience(
    prisma,
    workspaceId,
    {
      destinationId: input.destinationId,
      syncId,
      requestId,
      displayName: input.audience.displayName,
      exclusiveManagementConfirmed: input.audience.exclusiveManagementConfirmed,
      customerMatchTermsAccepted: input.customerMatchTermsAccepted,
    },
    nango
  );
  if (result.status !== "ready") return { status: "pending" as const };
  await mutation(prisma, workspaceId, async tx => {
    const link = await linkFor(tx, workspaceId, syncId);
    if ((await sourceFor(tx, workspaceId, input)).binding !== binding)
      throw conflict("Model or destination changed during provisioning");
    const current = await setupFor(tx, workspaceId, syncId);
    if (current?.record.ready) return;
    const options = ReverseSyncOptions.parse(link.data);
    if (!options.disabled) throw conflict("Setup must remain disabled");
    await tx.configurationObjectLink.update({
      where: { id: syncId },
      data: {
        data: {
          ...options,
          streamOptions: {
            audienceId: result.audienceId!,
            managedAudienceId: result.id,
            customerMatchTermsAccepted: true,
          },
        },
      },
    });
    await tx.configurationObject.update({
      where: { id: setup.row.id },
      data: { config: { ...setup.record, ready: true, audienceName: result.displayName } },
    });
  });
  return { status: "ready" as const };
}
export async function updateReverseSync(
  prisma: PrismaClient,
  workspaceId: string,
  syncId: string,
  raw: unknown,
  nango: NangoConfig = nangoConfig
) {
  const settings = ReverseSyncSettings.parse(raw);
  if (settings.timezone !== undefined) settings.timezone = settings.timezone.trim() || "Etc/UTC";
  schedule(settings);
  // Re-enabling is admission, not a metadata-only edit.
  const before = await linkFor(prisma, workspaceId, syncId);
  const setup = await setupFor(prisma, workspaceId, syncId);
  let checked: Awaited<ReturnType<typeof validateReverseSetup>> | undefined;
  if (settings.disabled === false) {
    if (!setup?.record.ready) throw conflict("Complete audience setup before enabling");
    checked = await validateReverseSetup(prisma, workspaceId, setup.record.input, nango);
    if (checked.binding !== setup.record.binding)
      throw conflict("Delivery configuration changed; cannot enable this sync");
  }
  return mutation(prisma, workspaceId, async tx => {
    const link = await linkFor(tx, workspaceId, syncId);
    if (+link.updatedAt !== +before.updatedAt) throw conflict("Sync changed. Reload and try again.");
    const options = ReverseSyncOptions.parse(link.data);
    // Feature-off permits pause/cleanup, not schedule changes or admission.
    if (!(settings.disabled === true && Object.keys(settings).length === 1)) await assertModelsEnabled(tx, workspaceId);
    if (checked && setup && (await sourceFor(tx, workspaceId, setup.record.input)).binding !== checked.binding)
      throw conflict("Model or destination changed during validation");
    await tx.configurationObjectLink.update({
      where: { id: syncId },
      data: { data: { ...options, ...settings } as Prisma.InputJsonObject },
    });
    if (settings.disabled === false && !(await readReverseSync(tx, syncId, workspaceId)))
      throw conflict("Sync is unavailable");
    return { id: syncId };
  });
}
export async function deleteReverseSync(prisma: PrismaClient, workspaceId: string, syncId: string) {
  return mutation(prisma, workspaceId, async tx => {
    const link = await linkFor(tx, workspaceId, syncId);
    if (!ReverseSyncOptions.parse(link.data).disabled) throw conflict("Pause this sync before deleting it");
    if (await tx.source_task.count({ where: { sync_id: syncId, status: { in: ["RUNNING", "WAITING"] } } }))
      throw conflict("Cancel active or waiting attempts before deleting this sync");
    await tx.configurationObjectLink.update({ where: { id: syncId }, data: { deleted: true } });
    // Keep setup intent, owned audience and delivery evidence. Deletion never clears Google.
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
      const setup = await setupFor(prisma, workspaceId, link.id);
      const latestTask = await prisma.source_task.findFirst({
        where: { sync_id: link.id, package: "jitsu/retl-runner" },
        orderBy: { started_at: "desc" },
        select: taskSelect,
      });
      const control = await prisma.reverse_sync_control.findFirst({
        where: { workspace_id: workspaceId, sync_id: link.id },
        select: { phase: true },
      });
      return ReverseSyncView.parse({
        id: link.id,
        fromId: link.fromId,
        toId: link.toId,
        modelName: (link.from.config as any).name || link.from.id,
        destinationName: (link.to.config as any).name || link.to.id,
        options: link.data,
        setupPending: !!setup && !setup.record.ready,
        audienceName: setup?.record.audienceName,
        latestTask,
        phase: control?.phase ?? null,
      });
    })
  );
}
export async function reverseTasks(
  prisma: PrismaClient,
  workspaceId: string,
  filter: { syncId?: string; taskId?: string }
) {
  const links = await prisma.configurationObjectLink.findMany({
    where: { workspaceId, type: "reverse-sync", ...(filter.syncId ? { id: filter.syncId } : {}) },
    select: { id: true },
  });
  return prisma.source_task.findMany({
    where: {
      sync_id: { in: links.map(l => l.id) },
      package: "jitsu/retl-runner",
      ...(filter.taskId ? { task_id: filter.taskId } : {}),
    },
    select: taskSelect,
    orderBy: { started_at: "desc" },
    take: 100,
  });
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
