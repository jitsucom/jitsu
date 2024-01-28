import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { getServerLog } from "../../../../../lib/server/log";
import { ApiError } from "../../../../../lib/shared/errors";
import { getConfigObjectType, parseObject } from "../../../../../lib/schema/config-objects";
import { prepareZodObjectForDeserialization } from "../../../../../lib/zod";
import { isReadOnly } from "../../../../../lib/server/read-only-mode";
import { enableAuditLog } from "../../../../../lib/server/audit-log";
import { trackTelemetryEvent } from "../../../../../lib/server/telemetry";

function defaultMerge(a, b) {
  return { ...a, ...b };
}

const log = getServerLog("config-api");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb", // Set desired value here
    },
  },
};

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    },
    handle: async ({ user, query: { id, workspaceId, type } }) => {
      await verifyAccess(user, workspaceId);
      const configObjectType = getConfigObjectType(type);
      const object = await db.prisma().configurationObject.findFirst({
        where: { workspaceId, id, deleted: false },
      });
      if (!object) {
        throw new ApiError(`${type} with id ${id} does not exist`, {}, { status: 400 });
      }
      const preFilter = { ...((object.config as any) || {}), workspaceId, id, type };
      return configObjectType.outputFilter(preFilter);
    },
  },
  PUT: {
    types: {
      query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    },
    auth: true,
    handle: async ({ user, body, query }) => {
      body = prepareZodObjectForDeserialization(body);
      const { id, workspaceId, type } = query;
      if (isReadOnly) {
        throw new ApiError("Console is in read-only mode. Modifications of objects are not allowed");
      }
      await verifyAccess(user, workspaceId);
      const configObjectType = getConfigObjectType(type);
      const object = await db.prisma().configurationObject.findFirst({
        where: { workspaceId: workspaceId, id, deleted: false },
      });
      if (!object) {
        throw new ApiError(`${type} with id ${id} does not exist`);
      }
      const data = parseObject(type, body);
      const merged = configObjectType.merge(object.config, data);
      const filtered = await configObjectType.inputFilter(merged, "update");

      delete filtered.id;
      delete filtered.workspaceId;
      await db.prisma().configurationObject.update({ where: { id }, data: { config: filtered } });
      await trackTelemetryEvent("config-object-update", { objectType: type });
      if (enableAuditLog) {
        await db.prisma().auditLog.create({
          data: {
            type: "config-object-update",
            workspaceId,
            objectId: id,
            userId: user.internalId,
            changes: {
              objectType: type,
              prevVersion: object.config,
              newVersion: filtered,
            },
          },
        });
      }
    },
  },
  DELETE: {
    auth: true,
    types: {
      query: z.object({ type: z.string(), workspaceId: z.string(), id: z.string() }),
    },
    handle: async ({ user, body, query }) => {
      const { id, workspaceId, type } = query;
      await verifyAccess(user, workspaceId);
      if (isReadOnly) {
        throw new ApiError("Console is in read-only mode. Modifications of objects are not allowed");
      }
      const object = await db.prisma().configurationObject.findFirst({
        where: { workspaceId: workspaceId, id, deleted: false },
      });
      if (object) {
        await db.prisma().configurationObject.update({
          where: { id: object.id },
          data: { deleted: true },
        });
        await trackTelemetryEvent("config-object-delete", { objectType: type });
        if (enableAuditLog) {
          await db.prisma().auditLog.create({
            data: {
              type: "config-object-delete",
              workspaceId,
              objectId: id,
              userId: user.internalId,
              changes: {
                objectType: type,
                prevVersion: object.config,
              },
            },
          });
        }
        return { ...((object.config as any) || {}), workspaceId, id, type };
      }
    },
  },
};

export default nextJsApiHandler(api);
