import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { fastStore } from "../../../../lib/server/fast-store";
import { randomId } from "juava";
import { syncWithScheduler } from "../../../../lib/server/sync-scheduler";
import { getAppEndpoint } from "../../../../lib/domains";

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
          orderBy: { createdAt: "asc" },
        }),
      };
    },
  },
  POST: {
    auth: true,
    types: {
      query: z.object({ workspaceId: z.string() }),
      body: z.object({
        id: z.string().optional(),
        data: z.any().optional(),
        toId: z.string(),
        fromId: z.string(),
        type: z.string().optional(),
      }),
    },
    handle: async ({ body, user, query: { workspaceId }, req }) => {
      const { id, toId, fromId, data = undefined, type = "push" } = body;
      await verifyAccess(user, workspaceId);
      const fromType = type === "sync" ? "service" : "stream";

      // we allow duplicates of service=>dst links because they may have different streams and scheduling
      const existingLink =
        type === "push"
          ? await db.prisma().configurationObjectLink.findFirst({
              where: { workspaceId: workspaceId, toId, fromId, deleted: false },
            })
          : id
          ? await db.prisma().configurationObjectLink.findFirst({ where: { id, deleted: false } })
          : undefined;

      if (!id && existingLink) {
        throw new Error(`Link from '${fromId}' to '${toId}' already exists`);
      }

      const co = db.prisma().configurationObject;
      if (
        !(await co.findFirst({
          where: { workspaceId: workspaceId, type: fromType, id: fromId, deleted: false },
        }))
      ) {
        throw new Error(`${fromType} object with id '${fromId}' not found in the workspace '${workspaceId}'`);
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
        //try to do asynchronously for edit
        syncWithScheduler(getAppEndpoint(req).baseUrl);
        await fastStore.fullRefresh();
        return { id: existingLink.id, created: false };
      }
      const created = await db.prisma().configurationObjectLink.create({
        data: {
          id: `${workspaceId}-${fromId.substring(fromId.length - 4)}-${toId.substring(toId.length - 4)}-${randomId(6)}`,
          workspaceId,
          fromId,
          toId,
          data,
          type,
        },
      });
      await syncWithScheduler(getAppEndpoint(req).baseUrl);
      await fastStore.fullRefresh();
      return { id: created.id, created: true };
    },
  },
  DELETE: {
    auth: true,
    types: {
      query: z.object({ workspaceId: z.string(), type: z.string().optional(), toId: z.string(), fromId: z.string() }),
    },
    handle: async ({ user, query: { workspaceId, fromId, toId }, req }) => {
      await verifyAccess(user, workspaceId);
      const existingLink = await db.prisma().configurationObjectLink.findFirst({
        where: { workspaceId: workspaceId, toId, fromId, deleted: false },
      });
      if (!existingLink) {
        return { deleted: false };
      }
      await db.prisma().configurationObjectLink.update({ where: { id: existingLink.id }, data: { deleted: true } });
      await syncWithScheduler(getAppEndpoint(req).baseUrl);
      await fastStore.fullRefresh();
      return { deleted: true };
    },
  },
};
export default nextJsApiHandler(api);
