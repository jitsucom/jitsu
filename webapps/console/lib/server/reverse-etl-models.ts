import type { PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { createWarehouseReader, getWarehouseSqlDialect } from "@jitsu/warehouse-query";
import { ModelDefinition, supportsWarehouseReader } from "@jitsu/warehouse-query/src/schema";
import { ApiError } from "../shared/errors";

type ModelDb = Pick<PrismaClient, "workspace" | "configurationObject" | "configurationObjectLink" | "$queryRaw">;

// Serialize reference checks with config writes across console instances. Remote
// warehouse inspection happens BEFORE this short transaction, never under a lock.
export async function modelMutation<T>(
  prisma: PrismaClient,
  workspaceId: string,
  type: string,
  write: (db: ModelDb) => Promise<T>
): Promise<T> {
  if (!["model", "destination"].includes(type)) return write(prisma);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`retl-models:${workspaceId}`}, 0))`;
    return write(tx);
  });
}

export async function recheckModelWarehouse(
  prisma: ModelDb,
  workspaceId: string,
  warehouseId: string,
  inspectedConfig: unknown
) {
  // Called only by create/update inside modelMutation's final transaction, after
  // remote inspection. The row lock also serializes with flag updates that do not
  // take our advisory lock, keeping the gate stable until the model write commits.
  await prisma.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR SHARE`;
  await assertModelsEnabled(prisma, workspaceId);
  const current = await getModelWarehouse(prisma, workspaceId, warehouseId);
  if (!isDeepStrictEqual(current, inspectedConfig))
    throw new ApiError("Warehouse changed during validation. Save the model again.", { status: 409 });
}

export async function assertModelsEnabled(prisma: ModelDb, workspaceId: string) {
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, deleted: false } });
  if (!workspace?.featuresEnabled.includes("reverse-etl")) {
    throw new ApiError("Reverse ETL is not enabled for this workspace", { status: 403 });
  }
}

export async function getModelWarehouse(prisma: ModelDb, workspaceId: string, warehouseId: string) {
  const object = await prisma.configurationObject.findFirst({
    where: { id: warehouseId, workspaceId, type: "destination", deleted: false },
  });
  if (!object) throw new ApiError("Warehouse destination not found in this workspace", { status: 404 });
  const config = object.config as Record<string, any>;
  if (!supportsWarehouseReader(config)) {
    throw new ApiError("Models support Postgres password connections and HTTP(S) ClickHouse connections", {
      status: 400,
    });
  }
  return config;
}

export async function validateModelForSave(prisma: PrismaClient, workspaceId: string, input: unknown) {
  await assertModelsEnabled(prisma, workspaceId);
  const model = ModelDefinition.parse(input);
  const config = await getModelWarehouse(prisma, workspaceId, model.warehouseId);
  // Query syntax/projection errors are actionable; raw database exceptions may
  // include credentials, SQL literals or source values and are never returned.
  try {
    getWarehouseSqlDialect(config.destinationType).validateQuery(model.query);
  } catch (e) {
    throw new ApiError((e as Error).message, { status: 400 });
  }
  const reader = safeReader(config);
  try {
    let columns;
    try {
      columns = await reader.columns(model.query, AbortSignal.timeout(30_000));
    } catch {
      throw new ApiError(
        "Could not inspect model columns. Check the warehouse connection, read permissions and query.",
        { status: 400 }
      );
    }
    try {
      reader.sql.validateColumns(model, columns);
    } catch (e) {
      throw new ApiError((e as Error).message, { status: 400 });
    }
  } finally {
    await reader.close();
  }
  return config;
}

function safeReader(config: Record<string, any>) {
  try {
    return createWarehouseReader(config);
  } catch {
    throw new ApiError("Warehouse connection settings are invalid or unsupported", { status: 400 });
  }
}

export async function previewModel(
  prisma: PrismaClient,
  workspaceId: string,
  warehouseId: string,
  query: string,
  signal?: AbortSignal
) {
  await assertModelsEnabled(prisma, workspaceId);
  const config = await getModelWarehouse(prisma, workspaceId, warehouseId);
  try {
    getWarehouseSqlDialect(config.destinationType).validateQuery(query);
  } catch (e) {
    throw new ApiError((e as Error).message, { status: 400 });
  }
  const reader = safeReader(config);
  try {
    const preview = await reader.preview(query, signal ?? AbortSignal.timeout(30_000));
    return {
      ...preview,
      columns: preview.columns.map(c => ({ ...c, supportsDelete: reader.sql.supportsDeleteType(c.type) })),
    };
  } catch {
    throw new ApiError(
      "Preview failed or exceeded its limit. Check read permissions and SQL, or select fewer columns.",
      { status: 400 }
    );
  } finally {
    await reader.close();
  }
}

export async function guardModelReferences(prisma: ModelDb, workspaceId: string, id: string, type: string) {
  if (type === "destination") {
    const models = await prisma.configurationObject.count({
      where: { workspaceId, type: "model", deleted: false, config: { path: ["warehouseId"], equals: id } },
    });
    if (models)
      throw new ApiError(`Warehouse is referenced by ${models} model(s). Delete or reassign those models first.`, {
        status: 409,
      });
  }
  if (type === "model" || type === "destination") {
    const links = await prisma.configurationObjectLink.count({
      where: { workspaceId, deleted: false, type: "reverse-sync", OR: [{ fromId: id }, { toId: id }] },
    });
    if (links) throw new ApiError("Object is referenced by a reverse sync. Remove that sync first.", { status: 409 });
  }
}
