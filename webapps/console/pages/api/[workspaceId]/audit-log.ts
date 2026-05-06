import { createRoute, verifyAccessWithRole } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { Prisma } from "@prisma/client";

// Same MASKED_SECRET sentinel that audit-log.ts and the destination editor use.
// Inlined to avoid pulling lib/schema/destinations through this read API path.
const MASKED_SECRET = "__MASKED_BY_JITSU__";

// Field-name patterns that we always treat as secrets. Mirrors the scrubber
// in lib/server/audit-log.ts. We re-apply it on read so old rows (written
// before the write-side scrubber existed) don't leak credentials through the
// diff column.
const SENSITIVE_KEY_PATTERN =
  /^(.*(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|private[_-]?key|client[_-]?secret|webhook[_-]?secret|ssh[_-]?key|ssl[_-]?key|signing[_-]?key|encryption[_-]?key|auth(orization)?)|token)$/i;

function genericScrub(input: any, depth = 0): any {
  if (depth > 8 || input == null) return input;
  if (Array.isArray(input)) {
    return input.map(v => genericScrub(v, depth + 1));
  }
  if (typeof input !== "object") {
    return input;
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(k) && v != null && v !== MASKED_SECRET) {
      out[k] = MASKED_SECRET;
    } else {
      out[k] = genericScrub(v, depth + 1);
    }
  }
  return out;
}

// Allow-list of fields always safe to return in `changes`.
const ALWAYS_SAFE_FIELDS = new Set([
  "objectType",
  "objectName",
  "actorEmail",
  "targetEmail",
  "targetUserId",
  "prevRole",
  "newRole",
  "email",
  "name",
  "workspaceName",
]);

type DiffEntry = { field: string; description: string };

function isPlainObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Hard cap to bound the audit-log API payload. The client middle-truncates
// for display and shows the full value in a tooltip, so values up to this
// limit reach the browser intact.
const MAX_VALUE_CHARS = 2000;

function fmtValue(v: any): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  let s: string;
  if (typeof v === "string") {
    s = `"${v}"`;
  } else if (typeof v === "number" || typeof v === "boolean") {
    s = String(v);
  } else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}…` : s;
}

// Identity / metadata fields that shouldn't appear in a user-facing diff.
// They live on the configurationObject row, not in the JSON config, but legacy
// audit-log payloads sometimes serialized them inline — which then shows up as
// "id removed" noise once we strip them on save.
const DIFF_IGNORED_KEYS = new Set(["id", "workspaceId", "type", "cloneId"]);

function stripDiffNoise(obj: any): any {
  if (!isPlainObject(obj)) return obj;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!DIFF_IGNORED_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Flatten a (prev, next) pair into a list of leaf-level changes. Recurses
 * through plain objects on both sides (including the case where one side is
 * `undefined` — i.e. create / delete — so the diff lists each leaf field
 * individually rather than dumping the whole object as one row). Arrays and
 * primitives are compared as atomic values.
 *
 * Masked secrets are surfaced as "changed (secret value)" without leaking
 * the masked sentinel.
 */
function flattenDiff(prev: any, next: any, base = ""): DiffEntry[] {
  if (shallowEqual(prev, next)) return [];

  // Both sides are plain objects — recurse on the union of keys.
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));
    const result: DiffEntry[] = [];
    for (const k of keys) {
      const path = base ? `${base}.${k}` : k;
      result.push(...flattenDiff(prev[k], next[k], path));
    }
    return result;
  }

  // One side is missing and the other is a plain object — recurse so each
  // leaf appears on its own row (`a.b.c → added: "..."` rather than a single
  // `(root) → added: {…large blob…}`).
  if (prev === undefined && isPlainObject(next)) {
    const result: DiffEntry[] = [];
    for (const k of Object.keys(next)) {
      const path = base ? `${base}.${k}` : k;
      result.push(...flattenDiff(undefined, next[k], path));
    }
    return result;
  }
  if (next === undefined && isPlainObject(prev)) {
    const result: DiffEntry[] = [];
    for (const k of Object.keys(prev)) {
      const path = base ? `${base}.${k}` : k;
      result.push(...flattenDiff(prev[k], undefined, path));
    }
    return result;
  }

  // Leaf rows: scalars and arrays.
  const label = base || "(root)";
  if (prev === undefined) {
    return [{ field: label, description: `added: ${fmtValue(next)}` }];
  }
  if (next === undefined) {
    return [{ field: label, description: `removed (was ${fmtValue(prev)})` }];
  }
  if (prev === MASKED_SECRET && next === MASKED_SECRET) {
    return [{ field: label, description: "changed (secret value)" }];
  }
  if (prev === MASKED_SECRET) {
    return [{ field: label, description: `changed: (secret) → ${fmtValue(next)}` }];
  }
  if (next === MASKED_SECRET) {
    return [{ field: label, description: `changed: ${fmtValue(prev)} → (secret)` }];
  }
  return [{ field: label, description: `changed: ${fmtValue(prev)} → ${fmtValue(next)}` }];
}

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
  diff: z
    .array(
      z.object({
        field: z.string(),
        description: z.string(),
      })
    )
    .optional(),
  actor: z
    .object({
      id: z.string(),
      email: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

function sanitizeChanges(raw: any): Record<string, any> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (ALWAYS_SAFE_FIELDS.has(k)) {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

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

    // Enrich link (connection) display names: a link has no `name` of its own,
    // so we synthesize "<from.name> → <to.name>" from the related entities.
    const linkIds = Array.from(
      new Set(
        page
          .filter(r => r.type.startsWith("config-object-") && (r.changes as any)?.objectType === "link" && r.objectId)
          .map(r => r.objectId as string)
      )
    );
    const links = linkIds.length
      ? await db.prisma().configurationObjectLink.findMany({
          where: { id: { in: linkIds } },
          include: { from: true, to: true },
        })
      : [];
    const linkNameById = new Map<string, string>();
    for (const l of links) {
      const fromName = ((l.from?.config as any)?.name as string) || l.fromId;
      const toName = ((l.to?.config as any)?.name as string) || l.toId;
      linkNameById.set(l.id, `${fromName} → ${toName}`);
    }

    return {
      items: page.map(r => {
        const rawChanges = (r.changes as any) || {};
        const isRedacted = rawChanges._redacted === true;
        const safeChanges = sanitizeChanges(rawChanges) || ({} as Record<string, any>);

        // Fall back to deriving objectName from prev/new versions when the row
        // (typically a pre-fix row) didn't store it. The raw versions stay
        // server-side; only the extracted name reaches the client.
        if (!safeChanges.objectName && r.type.startsWith("config-object-")) {
          const fromNew = (rawChanges.newVersion as any)?.name;
          const fromPrev = (rawChanges.prevVersion as any)?.name;
          if (typeof fromNew === "string" && fromNew) {
            safeChanges.objectName = fromNew;
          } else if (typeof fromPrev === "string" && fromPrev) {
            safeChanges.objectName = fromPrev;
          }
        }

        // For links, replace the (empty) objectName with the synthesized
        // "from → to" display name when available.
        if (safeChanges.objectType === "link" && r.objectId && linkNameById.has(r.objectId)) {
          safeChanges.objectName = linkNameById.get(r.objectId);
        }

        const finalChanges = Object.keys(safeChanges).length > 0 ? safeChanges : null;

        // Compute the diff on the fly. For redacted rows the values were already
        // masked at write time. For older rows we re-apply the name-based
        // scrubber on the way out so credentials never reach the client. In
        // both cases we strip identity / metadata keys (id, workspaceId, type,
        // cloneId) so they don't appear as noise in the diff.
        let diff: DiffEntry[] | undefined;
        if (r.type.startsWith("config-object-")) {
          const prevRaw = isRedacted ? rawChanges.prevVersion : genericScrub(rawChanges.prevVersion);
          const nextRaw = isRedacted ? rawChanges.newVersion : genericScrub(rawChanges.newVersion);
          const prev = prevRaw !== undefined ? stripDiffNoise(prevRaw) : undefined;
          const next = nextRaw !== undefined ? stripDiffNoise(nextRaw) : undefined;
          if (prev !== undefined || next !== undefined) {
            diff = flattenDiff(prev, next);
          }
        }

        return {
          id: r.id,
          timestamp: r.timestamp.toISOString(),
          type: r.type,
          severity: r.severity ?? null,
          workspaceId: r.workspaceId ?? null,
          userId: r.userId ?? null,
          objectId: r.objectId ?? null,
          authType: r.authType ?? null,
          changes: finalChanges,
          diff,
          actor: r.userId ? actorById.get(r.userId) ?? null : null,
        };
      }),
      nextCursor,
    };
  })
  .toNextApiHandler();
