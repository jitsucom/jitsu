import { createRoute, verifyAccess, verifyAccessWithRole } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { assertDefined, requireDefined } from "juava";
import {
  getAllConfigObjectTypeNames,
  getConfigObjectType,
  parseObject,
} from "../../../../../lib/schema/config-objects";
import { AnyDestination, getAnnotatedConfigObjectSchema } from "../../../../../lib/openapi/annotations";
import { configObjectAuditLog } from "../../../../../lib/server/audit-log";
import { trackTelemetryEvent, withProductAnalytics } from "../../../../../lib/server/telemetry";
import { containsMaskedSecrets, unmaskSecretsFromOriginal } from "../../../../../lib/schema/secrets";
import { getServerLog } from "../../../../../lib/server/log";

const log = getServerLog("api");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

// Spec-visible types — the runtime still accepts every type from getAllConfigObjectTypeNames(),
// but `misc` is an internal catch-all that we don't document publicly.
const publicTypeNames = getAllConfigObjectTypeNames().filter(t => t !== "misc");
const pluralType = (t: string) => `${t}s`;

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string(), type: z.string() }),
    result: z.object({ objects: z.array(z.any()) }),
    summary: "List configuration objects",
    tags: ["config"],
    expand: {
      param: "type",
      values: publicTypeNames,
      forValue: type => ({
        summary: `List ${pluralType(type)}`,
        tags: [type],
        result: z.object({
          objects: z.array(
            type === "destination"
              ? AnyDestination
              : getAnnotatedConfigObjectSchema(type) ?? getConfigObjectType(type).schema
          ),
        }),
      }),
    },
  })
  .handler(async ({ user, query: { workspaceId, type } }) => {
    await verifyAccess(user, workspaceId);
    const configObjectType = getConfigObjectType(type);
    assertDefined(configObjectType, `Invalid config object type: ${type}`);
    const objects = await db.prisma().configurationObject.findMany({
      where: { workspaceId: workspaceId, type, deleted: false },
      orderBy: { createdAt: "asc" },
    });
    const mappedObjects = objects.map(({ id, workspaceId, config, updatedAt }) => ({
      ...(config as any),
      id,
      workspaceId,
      type,
      updatedAt,
    }));

    const filteredObjects = await Promise.all(mappedObjects.map(obj => configObjectType.outputFilter(obj)));

    return {
      objects: filteredObjects,
    };
  })
  .POST({
    auth: true,
    query: z.object({ workspaceId: z.string(), type: z.string() }),
    body: z.any(),
    result: z.object({ id: z.string() }),
    summary: "Create a configuration object",
    tags: ["config"],
    expand: {
      param: "type",
      values: publicTypeNames,
      forValue: type => ({
        summary: `Create ${type}`,
        tags: [type],
        body:
          type === "destination"
            ? AnyDestination
            : getAnnotatedConfigObjectSchema(type) ?? getConfigObjectType(type).schema,
      }),
    },
  })
  .handler(async ({ req, body, user, query: { workspaceId, type } }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    const workspace = requireDefined(
      await db.prisma().workspace.findFirst({ where: { id: workspaceId } }),
      `Workspace ${workspaceId} not found`
    );
    const configObjectTypes = getConfigObjectType(type);
    let object = parseObject(type, body);
    if (body.cloneId) {
      log.atInfo().log(`Unmasking secrets for ${type} clone: ${body.id}`);
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
      { user, workspace: { id: workspaceId }, req }
    );
    await configObjectAuditLog(user, workspaceId, created.id, type, "create", { newVersion: object });
    return { id: created.id };
  });

export default route.toNextApiHandler();
