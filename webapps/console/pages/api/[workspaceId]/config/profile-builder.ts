import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { isTruish } from "juava";

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
      query: z.object({ workspaceId: z.string(), init: z.string().optional() }),
    },
    handle: async ({ user, query: { workspaceId, init } }) => {
      await verifyAccess(user, workspaceId);
      const pbs = await db.prisma().profileBuilder.findMany({
        where: { workspaceId: workspaceId, deleted: false },
        orderBy: { createdAt: "asc" },
      });
      if (pbs.length === 0 && isTruish(init)) {
        const func = await db.prisma().configurationObject.create({
          data: {
            workspaceId,
            type: "function",
            config: {
              kind: "profile",
              name: "Profile Builder function",
              code: `export default async function({ context, events, user}) => {
  context.log.info("Profile userId: " + user.id)
  const profile = {} as any
  profile.traits = user.traits
  profile.anonId = user.anonymousId
  return {
    properties: profile
  }
};`,
            },
          },
        });
        const pb = await db.prisma().profileBuilder.create({
          data: {
            workspaceId,
            name: "Profile Builder",
            intermediateStorageCredentials: {},
            connectionOptions: {},
          },
        });
        const link = await db.prisma().profileBuilderFunction.create({
          data: {
            profileBuilderId: pb.id,
            functionId: func.id,
          },
        });
        return {
          profileBuilders: await db.prisma().profileBuilder.findMany({
            include: { functions: true },
            where: { workspaceId: workspaceId, deleted: false },
            orderBy: { createdAt: "asc" },
          }),
        };
      } else {
        return {
          profileBuilders: await db.prisma().profileBuilder.findMany({
            include: { functions: true },
            where: { workspaceId: workspaceId, deleted: false },
            orderBy: { createdAt: "asc" },
          }),
        };
      }
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
