import { createRoute, verifyAccess, verifyAccessWithRole } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { ApiError } from "../../../../../lib/shared/errors";
import {
  getAllConfigObjectTypeNames,
  getConfigObjectType,
  parseObject,
} from "../../../../../lib/schema/config-objects";
import { AnyDestination, getAnnotatedConfigObjectSchema } from "../../../../../lib/openapi/annotations";
import { prepareZodObjectForDeserialization } from "../../../../../lib/zod";
import { isReadOnly } from "../../../../../lib/server/read-only-mode";
import { configObjectAuditLog } from "../../../../../lib/server/audit-log";
import { trackTelemetryEvent } from "../../../../../lib/server/telemetry";
import { requireDefined, deepCopy } from "juava";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

const typeNames = getAllConfigObjectTypeNames();

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    result: z.any(),
    summary: "Get a configuration object",
    tags: ["config"],
    expand: {
      param: "type",
      values: typeNames,
      forValue: type => ({
        summary: `Get ${type}`,
        tags: [type],
        result: type === "destination" ? AnyDestination : getAnnotatedConfigObjectSchema(type) ?? getConfigObjectType(type).schema,
      }),
    },
  })
  .handler(async ({ user, query: { id, workspaceId, type } }) => {
    await verifyAccess(user, workspaceId);
    const configObjectType = getConfigObjectType(type);
    const object = await db.prisma().configurationObject.findFirst({
      where: { workspaceId, id, deleted: false },
    });
    if (!object) {
      throw new ApiError(`${type} with id ${id} does not exist`, {}, { status: 400 });
    }
    const preFilter = { ...((object.config as any) || {}), workspaceId, id, type };
    return await configObjectType.outputFilter(preFilter);
  })
  .PUT({
    auth: true,
    query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    body: z.any(),
    summary: "Update a configuration object",
    tags: ["config"],
    expand: {
      param: "type",
      values: typeNames,
      forValue: type => ({
        summary: `Update ${type}`,
        tags: [type],
        body: type === "destination" ? AnyDestination : getAnnotatedConfigObjectSchema(type) ?? getConfigObjectType(type).schema,
      }),
    },
  })
  .handler(async ({ user, body, query }) => {
    body = prepareZodObjectForDeserialization(body);
    const { id, workspaceId, type } = query;
    if (isReadOnly) {
      throw new ApiError("Console is in read-only mode. Modifications of objects are not allowed");
    }
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    const workspace = requireDefined(
      await db.prisma().workspace.findFirst({ where: { id: workspaceId } }),
      `Workspace ${workspaceId} not found`
    );
    const configObjectType = getConfigObjectType(type);
    const object = await db.prisma().configurationObject.findFirst({
      where: { workspaceId: workspaceId, id, deleted: false },
    });
    if (!object) {
      throw new ApiError(`${type} with id ${id} does not exist`);
    }
    // Snapshot before merge — `merge` may mutate `object.config` in place, so capture
    // for the audit log up front (introduced in SOC2 audit-log work, PR #1288).
    const prevVersion = deepCopy(object.config);
    const merged = await configObjectType.merge(object.config, { ...body, id, workspaceId });
    const data = parseObject(type, merged);
    const filtered = await configObjectType.inputFilter(data, "update", workspace);

    delete filtered.id;
    delete filtered.workspaceId;
    await db.prisma().configurationObject.update({ where: { id }, data: { config: filtered } });
    await trackTelemetryEvent("config-object-update", { objectType: type });
    await configObjectAuditLog(user, workspaceId, id, type, "update", {
      prevVersion,
      newVersion: filtered,
    });
  })
  .DELETE({
    auth: true,
    query: z.object({
      type: z.string(),
      workspaceId: z.string(),
      id: z.string(),
      strict: z.string().optional(),
      cascade: z.string().optional(),
    }),
    summary: "Delete a configuration object",
    tags: ["config"],
    expand: {
      param: "type",
      values: typeNames,
      forValue: type => ({
        summary: `Delete ${type}`,
        tags: [type],
      }),
    },
  })
  .handler(async ({ user, query }) => {
    const { id, workspaceId, type, strict, cascade } = query;
    await verifyAccessWithRole(user, workspaceId, "deleteEntities");
    if (isReadOnly) {
      throw new ApiError("Console is in read-only mode. Modifications of objects are not allowed");
    }
    const object = await db.prisma().configurationObject.findFirst({
      where: { workspaceId: workspaceId, id, deleted: false },
    });
    if (!object) {
      return null;
    }

    const configObjectType = getConfigObjectType(type);
    if (configObjectType.onDelete) {
      await configObjectType.onDelete(object, {
        strict: strict === "true",
        cascade: cascade === "true",
      });
    }

    await db.prisma().configurationObject.update({
      where: { id: object.id },
      data: { deleted: true },
    });
    await trackTelemetryEvent("config-object-delete", { objectType: type });
    await configObjectAuditLog(user, workspaceId, id, type, "delete", { prevVersion: object.config });
    return { ...((object.config as any) || {}), workspaceId, id, type };
  });

export default route.toNextApiHandler();
