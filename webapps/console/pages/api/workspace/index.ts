import { createRoute, verifyAccessWithRole } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { requireDefined } from "juava";
import { withProductAnalytics } from "../../../lib/server/telemetry";
import { validateSlug, validateWorkspaceName } from "./validate";
import { ApiError } from "../../../lib/shared/errors";
import { workspaceAuditLog } from "../../../lib/server/audit-log";
import { WorkspaceListItemSchema } from "../../../lib/openapi/annotations";
import { omitDeleted } from "../../../lib/server/omit-deleted";

const MAX_LIMIT = 1_000_000;

// Pagination wrapper or plain array — preserved for back-compat with existing console callers.
const ListResultSchema = z.union([
  z.object({
    workspaces: z.array(WorkspaceListItemSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      totalCount: z.number(),
      hasMore: z.boolean(),
    }),
  }),
  z.array(WorkspaceListItemSchema),
]);

export const route = createRoute()
  .GET({
    auth: true,
    summary: "List workspaces",
    description:
      "Returns workspaces the authenticated user has access to. " +
      "If `page` is provided, the response is wrapped in `{ workspaces, pagination }`; otherwise an array is returned (back-compat). " +
      "Use the `id` of a workspace as the `workspaceId` path parameter on other endpoints.",
    tags: ["workspace"],
    query: z.object({
      // Accept as raw strings and parse in the handler — `?page=foo` then falls back
      // to defaults instead of returning 500. (`z.coerce.number()` rejects NaN; `.catch()`
      // breaks zod-to-openapi rendering. Plain `z.string()` keeps both happy. The
      // `.openapi()` annotation overrides the spec to render these as integers.)
      page: z.string().optional().openapi({ type: "integer", minimum: 0, description: "Zero-based page index" }),
      limit: z.string().optional().openapi({ type: "integer", minimum: 1, description: "Items per page" }),
      search: z.string().optional(),
    }),
    result: ListResultSchema,
  })
  .handler(async ({ user, query }) => {
    const { search } = query;
    const page = query.page !== undefined ? parseInt(query.page) || 0 : undefined;
    const limit = query.limit !== undefined ? parseInt(query.limit) || MAX_LIMIT : MAX_LIMIT;
    const offset = (page ?? 0) * limit;

    const userModel = requireDefined(
      await db.prisma().userProfile.findUnique({ where: { id: user.internalId } }),
      `User ${user.internalId} does not exist`
    );

    const searchCondition = search
      ? {
          OR: [
            { id: { contains: search, mode: "insensitive" as const } },
            { name: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

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
      .map(({ workspaceUserProperties, ...workspace }) =>
        omitDeleted({
          ...workspace,
          lastUsed: workspaceUserProperties?.[0]?.lastUsed || undefined,
          entities: userModel.admin ? workspace["_count"]?.configurationObject : undefined,
        })
      )
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
      } as any;
    } else {
      return workspaces as any;
    }
  })
  .POST({
    auth: true,
    summary: "Create a workspace",
    tags: ["workspace"],
    body: z.object({
      name: z.string().optional(),
      slug: z.string().optional(),
    }),
    query: z.object({
      onboarding: z.string().optional(),
    }),
    result: z.object({ id: z.string() }),
  })
  .handler(async ({ req, user, body, query }) => {
    const nameResult = validateWorkspaceName(body.name || "");
    if (!nameResult.valid) {
      throw new ApiError(`Invalid workspace name: ${nameResult.reason}`, { status: 400 });
    }
    const slugResult = await validateSlug(body.slug || "", undefined);
    if (!slugResult.valid) {
      throw new ApiError(`Invalid workspace slug: ${slugResult.reason}`, { status: 400 });
    }

    const newWorkspace = await db.prisma().workspace.create({
      data: {
        name: body.name!.trim(),
        slug: body.slug!.trim(),
      },
    });
    await db.prisma().workspaceAccess.create({
      data: { userId: user.internalId, workspaceId: newWorkspace.id, role: "owner" },
    });
    await withProductAnalytics(p => p.track("workspace_created"), { user, workspace: newWorkspace, req });

    if (query?.onboarding === "true") {
      await withProductAnalytics(p => p.track("workspace_onboarded"), { user, workspace: newWorkspace, req });
    }

    return { id: newWorkspace.id };
  })
  .DELETE({
    auth: true,
    summary: "Delete a workspace",
    tags: ["workspace"],
    body: z.object({ workspaceId: z.string() }),
    result: z.object({ message: z.string(), status: z.number() }),
  })
  .handler(async ({ body, user }) => {
    const workspaceId = body.workspaceId;
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

    await workspaceAuditLog(user, workspaceId, "deleted", { workspaceName: workspace.name });

    return { message: `${workspace.name} deleted successfully`, status: 200 };
  });

export default route.toNextApiHandler();
