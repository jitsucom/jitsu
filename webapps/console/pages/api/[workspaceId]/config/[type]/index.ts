import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { assertDefined } from "juava";
import { fastStore } from "../../../../../lib/server/fast-store";
import { getConfigObjectType, parseObject } from "../../../../../lib/schema/config-objects";

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
      return {
        objects: objects
          .map(({ id, workspaceId, config }) => ({
            ...(config as any),
            id,
            workspaceId,
            type,
          }))
          .map(configObjectType.outputFilter),
      };
    },
  },
  POST: {
    auth: true,
    types: {
      query: z.object({ workspaceId: z.string(), type: z.string() }),
      body: z.any(),
    },
    handle: async ({ body, user, query: { workspaceId, type } }) => {
      await verifyAccess(user, workspaceId);
      const configObjectTypes = getConfigObjectType(type);
      const object = await configObjectTypes.inputFilter(parseObject(type, body), "create");
      const id = object.id;
      delete object.id;
      delete object.workspaceId;
      const created = await db.prisma().configurationObject.create({
        data: { id, workspaceId: workspaceId, config: object, type },
      });
      await fastStore.fullRefresh();
      return { id: created.id };
    },
  },
};

export default nextJsApiHandler(api);
