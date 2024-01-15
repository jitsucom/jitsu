import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { requireDefined } from "juava";
import { withProductAnalytics } from "../../../lib/server/telemetry";

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    handle: async ({ user }) => {
      const userModel = requireDefined(
        await db.prisma().userProfile.findUnique({ where: { id: user.internalId } }),
        `User ${user.internalId} does not exist`
      );

      const baseList = userModel.admin
        ? await db.prisma().workspace.findMany({
            where: { deleted: false },
            include: { workspaceUserProperties: { where: { userId: userModel.id } } },
            orderBy: { createdAt: "asc" },
          })
        : (
            await db.prisma().workspaceAccess.findMany({
              where: { userId: user.internalId },
              include: { workspace: { include: { workspaceUserProperties: true } } },
              orderBy: { createdAt: "asc" },
            })
          ).map(({ workspace }) => workspace);

      return baseList
        .map(({ workspaceUserProperties, ...workspace }) => ({
          ...workspace,
          lastUsed: workspaceUserProperties?.[0]?.lastUsed || undefined,
        }))
        .sort((a, b) => (b.lastUsed?.getTime() || 0) - (a.lastUsed?.getTime() || 0));
    },
  },
  POST: {
    auth: true,
    types: {
      body: z.object({ name: z.string().optional() }),
    },
    handle: async ({ req, user, body }) => {
      const newWorkspace = await db.prisma().workspace.create({
        data: { name: body.name || `${user.name || user.email || user.externalId}'s new workspace` },
      });
      await db.prisma().workspaceAccess.create({ data: { userId: user.internalId, workspaceId: newWorkspace.id } });
      await withProductAnalytics(p => p.track("workspace_created"), { user, workspace: newWorkspace, req });
      return { id: newWorkspace.id };
    },
  },
};

export default nextJsApiHandler(api);
