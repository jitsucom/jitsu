import { createRoute, verifyAccessWithRole } from "../../../lib/api";
import { z } from "zod";
import { Prisma } from "@prisma/client";
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

    // Search matches workspace id / name / slug, case-insensitively. Kept as a raw fragment so it
    // can be composed into the ordering query below (see comment there for why raw SQL).
    const searchClause = search
      ? Prisma.sql`AND (w.id ILIKE ${`%${search}%`} OR w.name ILIKE ${`%${search}%`} OR w.slug ILIKE ${`%${search}%`})`
      : Prisma.empty;

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

    // Order by the current user's last-access time (most-recently-used first, never-opened last).
    // `lastUsed` lives on WorkspaceUserProperties — a per-user, to-many relation on Workspace — so
    // Prisma's `orderBy` can't express it (it only orders to-many relations by `_count`). Raw SQL
    // with a LEFT JOIN drives the pagination window by `lastUsed` while keeping never-opened
    // workspaces (they sort last via NULLS LAST). Non-admins are scoped by WorkspaceAccess; admins
    // see every workspace plus its configuration-object count.
    const order = Prisma.sql`ORDER BY wup."lastUsed" DESC NULLS LAST, w."createdAt" ASC LIMIT ${limit} OFFSET ${offset}`;
    const rows: any[] = userModel.admin
      ? await db.prisma().$queryRaw`
          SELECT w.*, wup."lastUsed",
            (SELECT count(*) FROM newjitsu."ConfigurationObject" co
               WHERE co."workspaceId" = w.id AND co.deleted = false) AS entities
          FROM newjitsu."Workspace" w
          LEFT JOIN newjitsu."WorkspaceUserProperties" wup
            ON wup."workspaceId" = w.id AND wup."userId" = ${user.internalId}
          WHERE w.deleted = false ${searchClause}
          ${order}`
      : await db.prisma().$queryRaw`
          SELECT w.*, wup."lastUsed"
          FROM newjitsu."Workspace" w
          JOIN newjitsu."WorkspaceAccess" wa
            ON wa."workspaceId" = w.id AND wa."userId" = ${user.internalId}
          LEFT JOIN newjitsu."WorkspaceUserProperties" wup
            ON wup."workspaceId" = w.id AND wup."userId" = ${user.internalId}
          WHERE w.deleted = false ${searchClause}
          ${order}`;

    const workspaces = rows.map(row =>
      omitDeleted({
        ...row,
        // Result is validated against ListResultSchema *before* JSON serialization, where
        // `lastUsed` is `z.string().datetime()`. Convert the Date to ISO so validation passes.
        lastUsed: row.lastUsed ? new Date(row.lastUsed).toISOString() : undefined,
        // Postgres `count(*)` comes back as BigInt via $queryRaw, which fails `z.number()` and
        // JSON serialization — coerce to a plain number.
        entities: userModel.admin && row.entities != null ? Number(row.entities) : undefined,
      })
    );

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
    result: z.object({ id: z.string() }),
    // Tight cap on workspace creation: 2 per 5 min per principal. Isolated from
    // the global POST budget via a custom bucket.
    rateLimit: { bucket: "workspace-create", bearer: 2, session: 2, windowMs: 5 * 60_000 },
  })
  .handler(async ({ req, user, body }) => {
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

    // `onboarding` is an internal telemetry signal set by the console's signup flow.
    // Read it from req.query directly so it stays out of the public OpenAPI spec.
    if (req.query?.onboarding === "true") {
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
  .handler(async ({ req, body, user }) => {
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

    await workspaceAuditLog(user, workspaceId, "deleted", { workspaceName: workspace.name }, req);
    await withProductAnalytics(p => p.track("workspace_deleted"), { user, workspace, req });

    return { message: `${workspace.name} deleted successfully`, status: 200 };
  });

export default route.toNextApiHandler();
