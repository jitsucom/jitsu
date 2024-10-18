import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { isTruish } from "juava";
import { ProfileBuilderDbModel } from "../../../../prisma/schema";
import { safeParseWithDate } from "../../../../lib/zod";
import { ApiError } from "../../../../lib/shared/errors";

const defaultProfileBuilderFunction = `export default async function({ context, events, user }) {
  context.log.info("Profile userId: " + user.id)
  const profile = {}
  profile.traits = user.traits
  profile.anonId = user.anonymousId
  return {
    properties: profile
  }
};`;

const postAndPutCfg = {
  auth: true,
  types: {
    query: z.object({ workspaceId: z.string() }),
    body: z.object({
      profileBuilder: z.any(),
      code: z.string(),
    }),
  },
  handle: async (ctx: any) => {
    const {
      body,
      user,
      query: { workspaceId },
      req,
    } = ctx;
    await verifyAccess(user, workspaceId);
    console.log("Profile builder: " + JSON.stringify(body.profileBuilder));
    const parseResult = safeParseWithDate(ProfileBuilderDbModel, body.profileBuilder);
    if (!parseResult.success) {
      throw new ApiError(`Failed to validate schema of profile-builder`, { object: body, error: parseResult.error });
    }
    const pb = parseResult.data;
    console.log("PB: " + JSON.stringify(pb));

    const existingPb =
      pb.id && (await db.prisma().profileBuilder.findFirst({ where: { id: pb.id, deleted: false, workspaceId } }));

    let createdOrUpdated;
    if (existingPb) {
      createdOrUpdated = await db.prisma().profileBuilder.update({
        where: { id: existingPb.id },
        data: { ...pb, deleted: false, workspaceId },
      });
    } else {
      createdOrUpdated = await db.prisma().profileBuilder.create({
        data: {
          ...pb,
          workspaceId,
        },
      });
    }
    const withFunc = await db.prisma().profileBuilder.findFirst({
      include: { functions: { include: { function: true } } },
      where: { id: createdOrUpdated.id, workspaceId: workspaceId, deleted: false },
    });
    if (withFunc && withFunc.functions.length > 0) {
      const func = withFunc.functions[0];
      console.log("Updating function: " + JSON.stringify(func));
      await db.prisma().configurationObject.update({
        where: { id: func.functionId },
        data: {
          config: { ...(func.function.config as any), code: body.code },
        },
      });
    } else {
      const func = await db.prisma().configurationObject.create({
        data: {
          workspaceId,
          type: "function",
          config: {
            kind: "profile",
            name: "Profile Builder function",
            code: body.code,
          },
        },
      });
      await db.prisma().profileBuilderFunction.create({
        data: {
          profileBuilderId: createdOrUpdated.id,
          functionId: func.id,
        },
      });
    }

    return { id: createdOrUpdated.id, created: !existingPb };
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
              code: defaultProfileBuilderFunction,
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
            include: { functions: { include: { function: true } } },
            where: { workspaceId: workspaceId, deleted: false },
            orderBy: { createdAt: "asc" },
          }),
        };
      } else {
        return {
          profileBuilders: await db.prisma().profileBuilder.findMany({
            include: { functions: { include: { function: true } } },
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
