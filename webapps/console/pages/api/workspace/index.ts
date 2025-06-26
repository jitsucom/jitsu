import { Api, inferUrl, nextJsApiHandler, verifyAccessWithRole } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { requireDefined } from "juava";
import { withProductAnalytics } from "../../../lib/server/telemetry";
import { WorkspaceDbModel } from "../../../prisma/schema";

const MAX_LIMIT = 1_000_000;

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({
        page: z
          .string()
          .transform(val => parseInt(val) || 0)
          .optional(),
        limit: z
          .string()
          .transform(val => parseInt(val) || MAX_LIMIT)
          .optional(),
        search: z.string().optional(),
      }),
      result: z.union([
        z.object({
          // Array of workspace objects with user-specific properties
          workspaces: z.array(
            WorkspaceDbModel.extend({
              lastUsed: z.date().optional(), // Last time user accessed this workspace
              entities: z.number().optional(), // Number of configuration objects (admin only)
            })
          ),
          // Pagination metadata for infinite loading
          pagination: z.object({
            page: z.number(), // Current page number (starts from 0)
            limit: z.number(), // Number of items per page
            totalCount: z.number(), // Total number of workspaces available to user
            hasMore: z.boolean(), // Whether more pages are available
          }),
        }),
        z.array(
          WorkspaceDbModel.extend({
            lastUsed: z.date().optional(), // Last time user accessed this workspace
            entities: z.number().optional(), // Number of configuration objects (admin only)
          })
        ),
      ]),
    },
    handle: async ({ user, query }) => {
      const { page, limit = MAX_LIMIT, search } = query;
      const offset = (page ?? 0) * limit;

      const userModel = requireDefined(
        await db.prisma().userProfile.findUnique({ where: { id: user.internalId } }),
        `User ${user.internalId} does not exist`
      );

      // Build search conditions
      const searchCondition = search
        ? {
            OR: [
              { id: { contains: search, mode: "insensitive" as const } },
              { name: { contains: search, mode: "insensitive" as const } },
              { slug: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {};

      // Get total count of all available workspaces (without search filter)
      const totalCount = userModel.admin
        ? await db.prisma().workspace.count({
            where: { deleted: false },
          })
        : await db.prisma().workspaceAccess.count({
            where: {
              userId: user.internalId,
              workspace: { deleted: false },
            },
          });

      const baseList = userModel.admin
        ? await db.prisma().workspace.findMany({
            where: { deleted: false, ...searchCondition },
            include: {
              workspaceUserProperties: { where: { userId: userModel.id } },
              _count: {
                select: { configurationObject: { where: { deleted: false } } },
              },
            },
            orderBy: { createdAt: "asc" },
            skip: offset,
            take: limit,
          })
        : (
            await db.prisma().workspaceAccess.findMany({
              where: {
                userId: user.internalId,
                workspace: { deleted: false, ...searchCondition },
              },
              include: { workspace: { include: { workspaceUserProperties: true } } },
              orderBy: { createdAt: "asc" },
              skip: offset,
              take: limit,
            })
          ).map(({ workspace }) => workspace);

      const workspaces = baseList
        .map(({ workspaceUserProperties, ...workspace }) => ({
          ...workspace,
          lastUsed: workspaceUserProperties?.[0]?.lastUsed || undefined,
          entities: userModel.admin ? workspace["_count"]?.configurationObject : undefined,
        }))
        .sort((a, b) => (b.lastUsed?.getTime() || 0) - (a.lastUsed?.getTime() || 0));

      if (typeof page !== "undefined") {
        return {
          workspaces,
          pagination: {
            page,
            limit,
            totalCount,
            hasMore: (page + 1) * limit < totalCount,
          },
        };
      } else {
        return workspaces;
      }
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
      await db.prisma().workspaceAccess.create({
        data: { userId: user.internalId, workspaceId: newWorkspace.id, role: "owner" },
      });
      await withProductAnalytics(p => p.track("workspace_created"), { user, workspace: newWorkspace, req });
      return { id: newWorkspace.id };
    },
  },
  DELETE: {
    auth: true,
    types: {
      body: z.object({ workspaceId: z.string() }),
    },
    handle: async ({ body, user }) => {
      const workspaceId = body.workspaceId;
      // "manageUsers" permission belongs to owners. Owners can delete the workspace.
      await verifyAccessWithRole(user, workspaceId, "manageUsers");

      const workspace = await db.prisma().workspace.findUnique({
        where: { id: workspaceId, deleted: false },
      });

      if (!workspace) {
        return { message: `Error Workspace ${workspaceId} not found`, status: 404 };
      }

      await db.prisma().workspace.update({
        where: { id: workspaceId },
        data: { deleted: true },
      });

      return { message: `${workspace.name} deleted successfully`, status: 200 };
    },
  },
};

export default nextJsApiHandler(api);
