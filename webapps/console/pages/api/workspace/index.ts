import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { requireDefined } from "juava";

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    handle: async ({ user }) => {
      const userModel = requireDefined(
        await db.prisma().userProfile.findUnique({ where: { id: user.internalId } }),
        `User ${user.internalId} does not exist`
      );
      if (userModel.admin) {
        return await db.prisma().workspace.findMany({ where: { deleted: false }, orderBy: { createdAt: "asc" } });
      }
      return (
        await db.prisma().workspaceAccess.findMany({
          where: { userId: user.internalId },
          include: { workspace: true },
          orderBy: { createdAt: "asc" },
        })
      )
        .map(res => res.workspace)
        .filter(w => !w.deleted);
    },
  },
  POST: {
    auth: true,
    types: {
      body: z.object({ name: z.string().optional() }),
    },
    handle: async ({ user, body }) => {
      const newWorkspace = await db.prisma().workspace.create({
        data: { name: body.name || `${user.name || user.email || user.externalId}'s new workspace` },
      });
      await db.prisma().workspaceAccess.create({ data: { userId: user.internalId, workspaceId: newWorkspace.id } });
      return { id: newWorkspace.id };
    },
  },
};

export default nextJsApiHandler(api);
