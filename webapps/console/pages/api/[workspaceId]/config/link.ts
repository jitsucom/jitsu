import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccess, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { randomId } from "juava";
import { createScheduler, deleteScheduler, scheduleSync, updateScheduler } from "../../../../lib/server/sync";
import { getAppEndpoint } from "../../../../lib/domains";
import { ConfigurationObjectLinkDbModel } from "../../../../prisma/schema";
import { SyncOptionsType } from "../../../../lib/schema";
import { ApiError } from "../../../../lib/shared/errors";

export type SyncDbModel = Omit<z.infer<typeof ConfigurationObjectLinkDbModel>, "data"> & {
  data?: SyncOptionsType;
};

const postAndPutCfg = {
  auth: true,
  types: {
    query: z.object({ workspaceId: z.string(), runSync: z.string().optional() }),
    body: z.object({
      id: z.string().optional(),
      data: z.any().optional(),
      toId: z.string(),
      fromId: z.string(),
      type: z.string().optional(),
    }),
  },
  handle: async (ctx: any) => {
    const {
      body,
      user,
      query: { workspaceId, runSync },
      req,
    } = ctx;
    const { id, toId, fromId, data = undefined, type = "push" } = body;
    await verifyAccessWithRole(user, workspaceId, "createEntities");
    const fromType = type === "sync" ? "service" : "stream";

    // we allow duplicates of service=>dst links because they may have different streams and scheduling
    const existingLink =
      type === "push"
        ? await db.prisma().configurationObjectLink.findFirst({
            where: { workspaceId: workspaceId, toId, fromId, deleted: false },
          })
        : id
        ? await db
            .prisma()
            .configurationObjectLink.findFirst({ where: { workspaceId: workspaceId, id, deleted: false } })
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
        //sync scheduler immediately, so if it fails, user sees the error
        await createScheduler(getAppEndpoint(req).baseUrl, createdOrUpdated);
      }
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
        links: await db.prisma().configurationObjectLink.findMany({
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
      query: z.union([
        z.object({ workspaceId: z.string(), type: z.string().optional(), toId: z.string(), fromId: z.string() }),
        z.object({ workspaceId: z.string(), type: z.string().optional(), id: z.string() }),
      ]),
    },
    handle: async ({ user, query: { workspaceId, fromId, toId, id }, req }) => {
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
        }
        return { deleted: updatedLinks.length > 0 };
      } else {
        return { deleted: false };
      }
    },
  },
};
export default nextJsApiHandler(api);
