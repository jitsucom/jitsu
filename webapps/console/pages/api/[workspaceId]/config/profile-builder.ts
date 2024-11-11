import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { isTruish } from "juava";
import { ProfileBuilderDbModel } from "../../../../prisma/schema";
import { safeParseWithDate } from "../../../../lib/zod";
import { ApiError } from "../../../../lib/shared/errors";

const defaultProfileBuilderFunction = `export default async function(events, user, context) {
  context.log.info("Profile userId: " + user.id)
  const profile = {}
  profile.anonId = user.anonymousId
  return {
    traits: profile
  }
};`;

async function updateFunctionCode(workspaceId: string, pbId: string, code: string) {
  const withFunc = await db.prisma().profileBuilder.findFirst({
    include: { functions: { include: { function: true } } },
    where: { id: pbId, workspaceId: workspaceId, deleted: false },
  });
  if (withFunc && withFunc.functions.length > 0) {
    const func = withFunc.functions[0];
    console.log("Updating function: " + JSON.stringify(func));
    await db.prisma().configurationObject.update({
      where: { id: func.functionId },
      data: {
        config: {
          ...(func.function.config as any),
          code: code,
          draft: code,
        },
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
          code: code,
          draft: code,
        },
      },
    });
    await db.prisma().profileBuilderFunction.create({
      data: {
        profileBuilderId: pbId,
        functionId: func.id,
      },
    });
  }
}

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
      await updateFunctionCode(workspaceId, existingPb.id, body.code);
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
      await updateFunctionCode(workspaceId, createdOrUpdated.id, body.code);
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
              draft: defaultProfileBuilderFunction,
              code: defaultProfileBuilderFunction,
            },
          },
        });
        const pb = await db.prisma().profileBuilder.create({
          data: {
            workspaceId,
            version: 0,
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
