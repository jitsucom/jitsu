import { createRoute, verifyAccessWithRole } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { Prisma } from "@prisma/client";

const ItemSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  severity: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  objectId: z.string().nullable().optional(),
  authType: z.string().nullable().optional(),
  changes: z.any().nullable().optional(),
  actor: z
    .object({
      id: z.string(),
      email: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      type: z.string().optional(),
      severity: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
    result: z.object({
      items: z.array(ItemSchema),
      nextCursor: z.string().optional(),
    }),
  })
  .handler(async ({ user, query }) => {
    // Resolve slug -> id, then enforce owner-only access.
    let workspaceId = query.workspaceId;
    const ws = await db.prisma().workspace.findFirst({
      where: { OR: [{ id: workspaceId }, { slug: workspaceId }] },
    });
    if (ws) {
      workspaceId = ws.id;
    }
    await verifyAccessWithRole(user, workspaceId, "manageUsers");

    const limit = query.limit ?? 50;
    const where: Prisma.AuditLogWhereInput = { workspaceId };
    if (query.type) {
      where.type = { in: query.type.split(",").filter(Boolean) };
    }
    if (query.severity) {
      where.severity = { in: query.severity.split(",").filter(Boolean) };
    }
    if (query.from || query.to) {
      where.timestamp = {};
      if (query.from) {
        (where.timestamp as Prisma.DateTimeFilter).gte = new Date(query.from);
      }
      if (query.to) {
        (where.timestamp as Prisma.DateTimeFilter).lte = new Date(query.to);
      }
    }

    // Cursor format: `${timestamp_iso}|${id}`. Items returned are strictly older than the cursor.
    if (query.cursor) {
      const [tsRaw, idRaw] = query.cursor.split("|");
      const ts = new Date(tsRaw);
      if (!isNaN(ts.getTime())) {
        const tsClause = (where.timestamp as Prisma.DateTimeFilter | undefined) ?? {};
        const cursorOr: Prisma.AuditLogWhereInput[] = [
          { ...where, timestamp: { ...tsClause, lt: ts } },
          { ...where, timestamp: { ...tsClause, equals: ts }, id: { lt: idRaw } },
        ];
        Object.assign(where, { OR: cursorOr });
        delete (where as any).timestamp;
      }
    }

    const rows = await db.prisma().auditLog.findMany({
      where,
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const nextCursor =
      hasMore && page.length > 0
        ? `${page[page.length - 1].timestamp.toISOString()}|${page[page.length - 1].id}`
        : undefined;

    // Bulk-fetch actor profiles.
    const userIds = Array.from(new Set(page.map(r => r.userId).filter((v): v is string => !!v)));
    const actors = userIds.length
      ? await db.prisma().userProfile.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const actorById = new Map(actors.map(a => [a.id, a]));

    return {
      items: page.map(r => ({
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        type: r.type,
        severity: r.severity ?? null,
        workspaceId: r.workspaceId ?? null,
        userId: r.userId ?? null,
        objectId: r.objectId ?? null,
        authType: r.authType ?? null,
        changes: r.changes ?? null,
        actor: r.userId ? actorById.get(r.userId) ?? null : null,
      })),
      nextCursor,
    };
  })
  .toNextApiHandler();
