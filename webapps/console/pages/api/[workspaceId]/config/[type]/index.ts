import { Api, inferUrl, nextJsApiHandler, verifyAccess, verifyAccessWithRole } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { assertDefined, requireDefined } from "juava";
import { getConfigObjectType, parseObject } from "../../../../../lib/schema/config-objects";
import { ApiError } from "../../../../../lib/shared/errors";
import { isReadOnly } from "../../../../../lib/server/read-only-mode";
import { enableAuditLog } from "../../../../../lib/server/audit-log";
import { trackTelemetryEvent, withProductAnalytics } from "../../../../../lib/server/telemetry";
import { containsMaskedSecrets, unmaskSecretsFromOriginal } from "../../../../../lib/schema/secrets";
import { getServerLog } from "../../../../../lib/server/log";

const log = getServerLog("api");

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
      query: z.object({ workspaceId: z.string(), type: z.string() }),
    },
    handle: async ({ user, query: { workspaceId, type } }) => {
      await verifyAccess(user, workspaceId);
      const configObjectType = getConfigObjectType(type);
      assertDefined(configObjectType, `Invalid config object type: ${type}`);
      const objects = await db.prisma().configurationObject.findMany({
        where: { workspaceId: workspaceId, type, deleted: false },
        orderBy: { createdAt: "asc" },
      });
      const mappedObjects = objects.map(({ id, workspaceId, config }) => ({
        ...(config as any),
        id,
        workspaceId,
        type,
      }));

      const filteredObjects = await Promise.all(mappedObjects.map(obj => configObjectType.outputFilter(obj)));

      return {
        objects: filteredObjects,
      };
    },
  },
  POST: {
    auth: true,
    types: {
      query: z.object({ workspaceId: z.string(), type: z.string() }),
      body: z.any(),
    },
    handle: async ({ req, body, user, query: { workspaceId, type } }) => {
      await verifyAccessWithRole(user, workspaceId, "editEntities");
      if (isReadOnly) {
        throw new ApiError("Console is in read-only mode. Modifications of objects are not allowed");
      }
      const workspace = requireDefined(
        await db.prisma().workspace.findFirst({ where: { id: workspaceId } }),
        `Workspace ${workspaceId} not found`
      );
      const configObjectTypes = getConfigObjectType(type);
      let object = parseObject(type, body);
      if (body.cloneId) {
        log.atInfo().log(`Unmasking secrets for ${type} clone: ${body.id}`);
        // restore masked secrets from clone's original
        if (containsMaskedSecrets(object)) {
          const clonesOriginal = await db.prisma().configurationObject.findFirst({
            where: { id: body.cloneId, workspaceId },
          });
          if (clonesOriginal?.config) {
            const dbConfig = clonesOriginal.config as any;
            object = unmaskSecretsFromOriginal(object, dbConfig);
          }
        }
      }
      object = await configObjectTypes.inputFilter(object, "create", workspace);
      const id = object.id;
      delete object.id;
      delete object.workspaceId;
      delete object.cloneId;
      const created = await db.prisma().configurationObject.create({
        data: { id, workspaceId: workspaceId, config: object, type },
      });
      await trackTelemetryEvent("config-object-create", { objectType: type });
      await withProductAnalytics(
        p =>
          p.track("create_object", {
            objectType: type,
          }),
        //there's no workspace name / id available. Maybe that's fine?
        { user, workspace: { id: workspaceId }, req }
      );
      if (enableAuditLog) {
        await db.prisma().auditLog.create({
          data: {
            type: "config-object-create",
            workspaceId,
            objectId: id,
            userId: user.internalId,
            changes: {
              objectType: type,
              newVersion: object,
            },
          },
        });
      }
      return { id: created.id };
    },
  },
};

export default nextJsApiHandler(api);
