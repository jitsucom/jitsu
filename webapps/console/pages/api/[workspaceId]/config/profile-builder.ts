import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";

const postAndPutCfg = {
  auth: true,
  types: {
    query: z.object({ workspaceId: z.string() }),
    body: z.object({
      id: z.string().optional(),
      // TODO
    }),
  },
  handle: async (ctx: any) => {
    // TODO
  },
};

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
        profileBuilders: await db.prisma().profileBuilder.findMany({
          where: { workspaceId: workspaceId, deleted: false },
          orderBy: { createdAt: "asc" },
        }),
      };
    },
  },
  POST: postAndPutCfg,
  PUT: postAndPutCfg,
  DELETE: {
    auth: true,
    types: {
      query: z.object({ workspaceId: z.string(), id: z.string() }),
    },
    handle: async ({ user, query: { workspaceId, id }, req }) => {
      await verifyAccess(user, workspaceId);
      const existingPB = await db.prisma().profileBuilder.findFirst({
        where: { workspaceId: workspaceId, id, deleted: false },
      });
      if (!existingPB) {
        return { deleted: false };
      }
      await db.prisma().profileBuilder.update({ where: { id: existingPB.id }, data: { deleted: true } });

      return { deleted: true };
    },
  },
};
export default nextJsApiHandler(api);
