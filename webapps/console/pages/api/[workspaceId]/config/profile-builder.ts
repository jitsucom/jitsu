import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { ProfileBuilderDbModel } from "../../../../prisma/schema";
import { safeParseWithDate } from "../../../../lib/zod";
import { ApiError } from "../../../../lib/shared/errors";
import { MASKED_SECRET } from "../../../../lib/schema/destinations";
import { configObjectAuditLog } from "../../../../lib/server/audit-log";
import { omitDeletedList } from "../../../../lib/server/omit-deleted";

async function updateFunctionCode(user: any, workspaceId: string, pbId: string, code: string) {
  const withFunc = await db.prisma().profileBuilder.findFirst({
    include: { functions: { include: { function: true } } },
    where: { id: pbId, workspaceId: workspaceId, deleted: false },
  });
  if (withFunc && withFunc.functions.length > 0) {
    const func = withFunc.functions[0];
    const newConfig = {
      ...(func.function.config as any),
      code: code,
      draft: code,
    };
    await db.prisma().configurationObject.update({
      where: { id: func.functionId },
      data: {
        config: newConfig,
      },
    });
    await configObjectAuditLog(user, workspaceId, func.functionId, "function", "update", {
      prevVersion: func.function.config,
      newVersion: newConfig,
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
    await configObjectAuditLog(user, workspaceId, func.id, "function", "create", {
      newVersion: func.config,
    });
  }
}

const upsertBody = z.object({
  profileBuilder: z.any(),
  code: z.string(),
});

const upsertResult = z.object({ id: z.string(), created: z.boolean() });

const upsertHandler = async (ctx: any) => {
  const {
    body,
    user,
    query: { workspaceId },
  } = ctx;
  await verifyAccessWithRole(user, workspaceId, "editEntities");
  const parseResult = safeParseWithDate(ProfileBuilderDbModel, body.profileBuilder);
  if (!parseResult.success) {
    throw new ApiError(`Failed to validate schema of profile-builder`, { object: body, error: parseResult.error });
  }
  const pb = parseResult.data;

  const existingPb =
    pb.id && (await db.prisma().profileBuilder.findFirst({ where: { id: pb.id, deleted: false, workspaceId } }));

  let createdOrUpdated;
  if (existingPb) {
    await updateFunctionCode(user, workspaceId, existingPb.id, body.code);
    createdOrUpdated = await db.prisma().profileBuilder.update({
      where: { id: existingPb.id },
      data: { ...pb, deleted: false, workspaceId },
    });
    await configObjectAuditLog(user, workspaceId, createdOrUpdated.id, "profilebuilder", "update", {
      prevVersion: existingPb,
      newVersion: createdOrUpdated,
    });
  } else {
    createdOrUpdated = await db.prisma().profileBuilder.create({
      data: {
        ...pb,
        workspaceId,
      },
    });
    await updateFunctionCode(user, workspaceId, createdOrUpdated.id, body.code);
    await configObjectAuditLog(user, workspaceId, createdOrUpdated.id, "profilebuilder", "create", {
      newVersion: createdOrUpdated,
    });
  }

  return { id: createdOrUpdated.id, created: !existingPb };
};

const upsertOptions = {
  auth: true as const,
  query: z.object({ workspaceId: z.string() }),
  body: upsertBody,
  result: upsertResult,
  tags: ["profile-builder"],
};

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    summary: "List profile builders",
    tags: ["profile-builder"],
  })
  .handler(async ({ user, query: { workspaceId } }) => {
    // Pure read. Bootstrap-on-empty moved to POST ./profile-builder/init so
    // the maintenance gate can keep the read path open (lib/store/index.tsx
    // prefetches this on every workspace load) without letting writes slip
    // through.
    const role = await verifyAccessWithRole(user, workspaceId, "readEntities");
    const pbs = await db.prisma().profileBuilder.findMany({
      include: { functions: { include: { function: true } } },
      where: { workspaceId: workspaceId, deleted: false },
      orderBy: { createdAt: "asc" },
    });
    if (!role.editEntities) {
      for (const pb of pbs) {
        const functionsEnv = pb.connectionOptions?.["variables"];
        if (typeof functionsEnv === "object" && functionsEnv !== null) {
          for (const key in functionsEnv) {
            functionsEnv[key] = MASKED_SECRET;
          }
        }
      }
    }
    return {
      profileBuilders: omitDeletedList(pbs),
    };
  })
  .POST({ ...upsertOptions, summary: "Create profile builder" })
  .handler(upsertHandler)
  .PUT({ ...upsertOptions, summary: "Update profile builder" })
  .handler(upsertHandler)
  .DELETE({
    auth: true,
    query: z.object({ workspaceId: z.string(), id: z.string() }),
    summary: "Delete profile builder",
    tags: ["profile-builder"],
  })
  .handler(async ({ user, query: { workspaceId, id } }) => {
    await verifyAccessWithRole(user, workspaceId, "deleteEntities");
    const existingPB = await db.prisma().profileBuilder.findFirst({
      where: { workspaceId: workspaceId, id, deleted: false },
    });
    if (!existingPB) {
      return { deleted: false };
    }
    const links = await db.prisma().profileBuilderFunction.findMany({
      where: { profileBuilderId: existingPB.id },
    });

    for (const link of links) {
      const func = await db.prisma().configurationObject.findFirst({
        where: { id: link.functionId },
      });
      if (func) {
        await db.prisma().configurationObject.update({
          where: { id: func.id },
          data: { deleted: true },
        });
        await configObjectAuditLog(user, workspaceId, func.id, "function", "delete", {
          prevVersion: func,
        });
      }
    }
    await db.prisma().profileBuilder.update({ where: { id: existingPB.id }, data: { deleted: true } });
    await configObjectAuditLog(user, workspaceId, existingPB.id, "profilebuilder", "delete", {
      prevVersion: existingPB,
    });
    return { deleted: true };
  });

export default route.toNextApiHandler();
