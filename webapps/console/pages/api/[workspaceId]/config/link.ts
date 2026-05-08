import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { randomId } from "juava";
import { createScheduler, deleteScheduler, scheduleSync, updateScheduler } from "../../../../lib/server/sync";
import { getAppEndpoint } from "../../../../lib/domains";
import { ConfigurationObjectLinkDbModel } from "../../../../prisma/schema";
import { SyncOptionsType } from "../../../../lib/schema";
import { ApiError } from "../../../../lib/shared/errors";
import { MASKED_SECRET, getCoreDestinationTypeNonStrict } from "../../../../lib/schema/destinations";
import { configObjectAuditLog } from "../../../../lib/server/audit-log";
import { omitDeletedList } from "../../../../lib/server/omit-deleted";

export type SyncDbModel = Omit<z.infer<typeof ConfigurationObjectLinkDbModel>, "data"> & {
  data?: SyncOptionsType;
};

const linkBodySchema = z.object({
  id: z.string().optional(),
  data: z.any().optional(),
  toId: z.string(),
  fromId: z.string(),
  type: z.string().optional(),
});

const linkUpsertResult = z.object({ id: z.string(), created: z.boolean() });

const upsertHandler = async (ctx: any) => {
  const {
    body,
    user,
    query: { workspaceId, runSync, strict },
    req,
  } = ctx;
  const { id, toId, fromId, data = undefined, type = "push" } = body;
  await verifyAccessWithRole(user, workspaceId, "editEntities");

  if (strict === "true" && data !== undefined) {
    if (type === "sync") {
      const parseResult = SyncOptionsType.safeParse(data);
      if (!parseResult.success) {
        throw new ApiError(
          `Invalid sync options: ${parseResult.error.message}`,
          { zodError: parseResult.error },
          { status: 400 }
        );
      }
    } else {
      const destination = await db.prisma().configurationObject.findFirst({
        where: { workspaceId, id: toId, type: "destination", deleted: false },
      });

      if (destination) {
        const destinationType = getCoreDestinationTypeNonStrict(destination.config?.["destinationType"]);
        if (destinationType?.connectionOptions) {
          const parseResult = destinationType.connectionOptions.safeParse(data);
          if (!parseResult.success) {
            throw new ApiError(
              `Invalid connection options for ${destination.config?.["destinationType"]}: ${parseResult.error.message}`,
              { zodError: parseResult.error },
              { status: 400 }
            );
          }
        }
      }
    }
  }
  const fromType = type === "sync" ? "service" : "stream";

  const existingLink =
    type === "push"
      ? await db.prisma().configurationObjectLink.findFirst({
          where: { workspaceId: workspaceId, toId, fromId, deleted: false },
        })
      : id
      ? await db.prisma().configurationObjectLink.findFirst({ where: { workspaceId: workspaceId, id, deleted: false } })
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
  let createdOrUpdated: SyncDbModel;
  if (existingLink) {
    createdOrUpdated = (await db.prisma().configurationObjectLink.update({
      where: { id: existingLink.id },
      data: { data, deleted: false, workspaceId },
    })) as SyncDbModel;
    if (
      (type === "sync" && data.schedule !== existingLink!.data?.["schedule"]) ||
      data.timezone !== existingLink!.data?.["timezone"]
    ) {
      if (!data.schedule) {
        await deleteScheduler(createdOrUpdated.id);
      } else {
        await updateScheduler(getAppEndpoint(req).baseUrl, createdOrUpdated);
      }
    }
    await configObjectAuditLog(user, workspaceId, createdOrUpdated.id, "link", "update", {
      prevVersion: existingLink,
      newVersion: createdOrUpdated,
    });
  } else {
    createdOrUpdated = (await db.prisma().configurationObjectLink.create({
      data: {
        id: `${workspaceId}-${fromId.substring(fromId.length - 4)}-${toId.substring(toId.length - 4)}-${randomId(6)}`,
        workspaceId,
        fromId,
        toId,
        data,
        type,
      },
    })) as SyncDbModel;
    if (type == "sync" && data.schedule) {
      await createScheduler(getAppEndpoint(req).baseUrl, createdOrUpdated);
    }
    await configObjectAuditLog(user, workspaceId, createdOrUpdated.id, "link", "create", {
      newVersion: createdOrUpdated,
    });
  }
  if (type === "sync" && (runSync === "true" || runSync === "1")) {
    await scheduleSync({
      req,
      user,
      trigger: "manual",
      workspaceId,
      syncIdOrModel: createdOrUpdated.id,
    });
  }
  return { id: createdOrUpdated.id, created: !existingLink };
};

const upsertOptions = {
  auth: true as const,
  query: z.object({
    workspaceId: z.string(),
    runSync: z.string().optional(),
    strict: z.string().optional(),
  }),
  body: linkBodySchema,
  result: linkUpsertResult,
  tags: ["link"],
};

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    summary: "List connection links in a workspace",
    tags: ["link"],
  })
  .handler(async ({ user, query: { workspaceId } }) => {
    const role = await verifyAccessWithRole(user, workspaceId, "readEntities");
    const links = await db.prisma().configurationObjectLink.findMany({
      where: { workspaceId: workspaceId, deleted: false },
      orderBy: { createdAt: "asc" },
    });
    if (!role.editEntities) {
      for (const link of links) {
        const functionsEnv = link.data?.["functionsEnv"];
        if (typeof functionsEnv === "object" && functionsEnv !== null) {
          for (const key in functionsEnv) {
            functionsEnv[key] = MASKED_SECRET;
          }
        }
      }
    }
    return {
      links: omitDeletedList(links),
    };
  })
  .POST({ ...upsertOptions, summary: "Create a connection link" })
  .handler(upsertHandler)
  .PUT({ ...upsertOptions, summary: "Update a connection link" })
  .handler(upsertHandler)
  .DELETE({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      type: z.string().optional(),
      id: z.string().optional(),
      fromId: z.string().optional(),
      toId: z.string().optional(),
    }),
    summary: "Delete a connection link",
    tags: ["link"],
  })
  .handler(async ({ user, query: { workspaceId, fromId, toId, id } }) => {
    await verifyAccessWithRole(user, workspaceId, "deleteEntities");
    if (id) {
      if (fromId || toId) {
        throw new ApiError("You can't specify 'fromId' or 'toId' with 'id'", {}, { status: 400 });
      }
      const updatedLink = await db
        .prisma()
        .configurationObjectLink.update({ where: { workspaceId, id }, data: { deleted: true } });
      if (!updatedLink) {
        return { deleted: false };
      }
      if (updatedLink.type == "sync") {
        await deleteScheduler(updatedLink.id);
      }
      await configObjectAuditLog(user, workspaceId, updatedLink.id, "link", "delete", {
        prevVersion: updatedLink,
      });
      return { deleted: true };
    } else if (fromId && toId) {
      if (id) {
        throw new ApiError("You can't specify 'id' with 'fromId' and 'toId'", {}, { status: 400 });
      }
      const updatedLinks = await db.prisma().configurationObjectLink.updateManyAndReturn({
        where: { workspaceId, toId, fromId, deleted: false },
        data: { deleted: true },
      });
      for (const updatedLink of updatedLinks) {
        if (updatedLink.type == "sync") {
          await deleteScheduler(updatedLink.id);
        }
        await configObjectAuditLog(user, workspaceId, updatedLink.id, "link", "delete", {
          prevVersion: updatedLink,
        });
      }
      return { deleted: updatedLinks.length > 0 };
    } else {
      return { deleted: false };
    }
  });

export default route.toNextApiHandler();
