import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { fastStore } from "../../../../lib/server/fast-store";

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({ workspaceId: z.string() }),
    },
    handle: async ({ user, query: { workspaceId } }) => {
      await verifyAccess(user, workspaceId);
      return {
        links: await db.prisma().configurationObjectLink.findMany({
          where: { workspaceId: workspaceId, deleted: false },
        }),
      };
    },
  },
  POST: {
    auth: true,
    types: {
      query: z.object({ workspaceId: z.string() }),
      body: z.object({ data: z.any().optional(), toId: z.string(), fromId: z.string() }),
    },
    handle: async ({ body, user, query: { workspaceId } }) => {
      const { toId, fromId, data = undefined } = body;
      await verifyAccess(user, workspaceId);
      const existingLink = await db.prisma().configurationObjectLink.findFirst({
        where: { workspaceId: workspaceId, toId, fromId, deleted: false },
      });
      const co = db.prisma().configurationObject;
      if (
        !(await co.findFirst({
          where: { workspaceId: workspaceId, type: "stream", id: fromId, deleted: false },
        }))
      ) {
        throw new Error(`Stream object with id '${fromId}' not found in the workspace '${workspaceId}'`);
      }
      if (
        !(await co.findFirst({
          where: { workspaceId: workspaceId, type: "destination", id: toId, deleted: false },
        }))
      ) {
        throw new Error(`Destination object with id '${toId}' not found in the workspace '${workspaceId}'`);
      }
      if (existingLink) {
        await db.prisma().configurationObjectLink.update({
          where: { id: existingLink.id },
          data: { data, deleted: false },
        });
        await fastStore.fullRefresh();
        return { id: existingLink.id, created: false };
      }
      const created = await db.prisma().configurationObjectLink.create({
        data: {
          id: `${workspaceId}_${fromId.substring(fromId.length - 8)}_${toId.substring(toId.length - 8)}`,
          workspaceId,
          fromId,
          toId,
          data,
        },
      });
      await fastStore.fullRefresh();
      return { id: created.id, created: true };
    },
  },
  DELETE: {
    auth: true,
    types: {
      query: z.object({ workspaceId: z.string(), type: z.string().optional(), toId: z.string(), fromId: z.string() }),
    },
    handle: async ({ user, query: { workspaceId, fromId, toId } }) => {
      await verifyAccess(user, workspaceId);
      const existingLink = await db.prisma().configurationObjectLink.findFirst({
        where: { workspaceId: workspaceId, toId, fromId, deleted: false },
      });
      if (!existingLink) {
        return { deleted: false };
      }
      await db.prisma().configurationObjectLink.update({ where: { id: existingLink.id }, data: { deleted: true } });
      await fastStore.fullRefresh();
      return { deleted: true };
    },
  },
};
export default nextJsApiHandler(api);
