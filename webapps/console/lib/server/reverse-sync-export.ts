import type { PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ModelDefinition, ReverseSyncOptions, supportsWarehouseReader } from "@jitsu/warehouse-query/src/schema";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { ApiError } from "../shared/errors";
import { managedGoogleAudienceForSync } from "./google-audiences";
import { GoogleAudienceOptions } from "@jitsu/destination-functions/src/functions/google-ads-reverse/meta";

type ReadDb = Pick<Prisma.TransactionClient, "configurationObjectLink" | "configurationObject">;

/** Missing/disabled is intentional omission; malformed active configuration fails the whole feed. */
export async function readReverseSync(
  db: ReadDb,
  id: string,
  workspaceId?: string
): Promise<ReverseRunConfig | undefined> {
  const link = await db.configurationObjectLink.findFirst({
    where: { id, ...(workspaceId ? { workspaceId } : {}), type: "reverse-sync", deleted: false },
    include: { from: true, to: true, workspace: true },
  });
  if (!link || link.workspace.deleted || !link.workspace.featuresEnabled.includes("reverse-etl")) return;
  const options = ReverseSyncOptions.parse(link.data);
  if (options.disabled || link.from.deleted || link.to.deleted) return;
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
  if (destination.destinationType === "google-ads") {
    const replacement = options.streamOptions.mirrorStrategy === "full-replace";
    // Existing admission also serves disabled, not-yet-provisioned setups. Only
    // native replacement needs this additional destructive-mode confirmation.
    if (replacement) GoogleAudienceOptions.parse(options.streamOptions);
    if (replacement && options.mode !== "mirror")
      throw new ApiError("Full replacement requires mirror mode", { status: 409 });
    if (options.mode === "mirror" || options.streamOptions.managedAudienceId !== undefined) {
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
    schedule: options.schedule,
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
      const config = await db.$transaction(tx => readReverseSync(tx, row.id), { isolationLevel: "RepeatableRead" });
      if (config) {
        writer.write(`${comma ? "," : ""}${JSON.stringify(config)}`);
        comma = true;
      }
      after = row.id;
    }
  }
  writer.write("]");
}
