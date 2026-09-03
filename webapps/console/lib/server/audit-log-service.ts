import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { SessionUser } from "../schema";
import { verifyAccessWithRole, verifyAdmin } from "../api";
import { ApiError } from "../shared/errors";

// Display sentinel used by genericScrub output. The canonical sentinel emitted
// by lib/schema/secrets#maskSecrets (via per-type outputFilter) is different
// — see CANONICAL_MASKED_SECRET below — so we recognize both when deciding
// whether a value is "a masked secret".
const MASKED_SECRET = "*********";
const CANONICAL_MASKED_SECRET = "__MASKED_BY_JITSU__";

function isMasked(v: any): boolean {
  return v === MASKED_SECRET || v === CANONICAL_MASKED_SECRET;
}

// Field-name patterns that we always treat as secrets. Mirrors the scrubber
// in lib/server/audit-log.ts. We re-apply it on read so old rows (written
// before the write-side scrubber existed) don't leak credentials through the
// diff column.
const SENSITIVE_KEY_PATTERN =
  /^(.*(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|private[_-]?key|client[_-]?secret|webhook[_-]?secret|auth(orization)?)|token)$/i;

// Lazy require so this module doesn't pull lib/schema/config-objects at
// module-load time (config-objects → domain-check → lib/api.ts cycles).
let configObjectsModule: typeof import("../schema/config-objects") | null = null;
function loadConfigObjects(): typeof import("../schema/config-objects") {
  if (!configObjectsModule) {
    configObjectsModule = require("../schema/config-objects");
  }
  return configObjectsModule!;
}

/**
 * For known object types, run the same `outputFilter` the editor UI sees —
 * destinations and services strip secrets at schema-marked paths
 * (credentialsUi[*].password / airbyte_secret), streams strip key
 * plaintext+hash. This is the canonical mask for legacy audit rows that
 * weren't redacted at write time.
 */
async function applyOutputFilter(type: string, obj: any): Promise<any> {
  if (obj == null || typeof obj !== "object") return obj;
  try {
    const cm = loadConfigObjects();
    if (cm.getAllConfigObjectTypeNames().includes(type)) {
      return await cm.getConfigObjectType(type).outputFilter(obj);
    }
  } catch {
    // outputFilter can throw on partial data (e.g. destination without
    // destinationType). Fall back to the raw object — genericScrub still runs
    // afterward as a defense-in-depth pass.
  }
  return obj;
}

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
    if (SENSITIVE_KEY_PATTERN.test(k) && v != null && !isMasked(v)) {
      out[k] = MASKED_SECRET;
    } else {
      out[k] = genericScrub(v, depth + 1);
    }
  }
  return out;
}

// Summary metadata that audit-log helpers stash inside the `changes` JSON
// column. We enumerate the fields the client may receive — the raw config
// blobs `prevVersion` / `newVersion` are explicitly NOT in this list (they
// are reduced to a `diff` server-side and never sent), and the internal
// `_redacted` marker stays server-side.
const SUMMARY_FIELDS = [
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
] as const;

function pickSummary(raw: any): Record<string, any> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, any> = {};
  for (const k of SUMMARY_FIELDS) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return Object.keys(out).length > 0 ? out : null;
}

export type DiffEntry = {
  field: string;
  // "noop" appears when an audit row was written but prev/next are byte-equal
  // after stripping identity fields (e.g. user clicked Save without editing).
  kind: "added" | "removed" | "changed" | "secret-changed" | "noop";
  prev?: string;
  next?: string;
};

function fmtMaybeSecret(v: any): string {
  return isMasked(v) ? MASKED_SECRET : fmtValue(v);
}

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

// Hard cap to bound the audit-log payload. The UI middle-truncates for
// display and shows the full value in a tooltip, so values up to this limit
// reach the client intact.
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
 */
function flattenDiff(prev: any, next: any, base = ""): DiffEntry[] {
  if (shallowEqual(prev, next)) return [];

  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));
    const result: DiffEntry[] = [];
    for (const k of keys) {
      const path = base ? `${base}.${k}` : k;
      result.push(...flattenDiff(prev[k], next[k], path));
    }
    return result;
  }

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

  const field = base || "(root)";
  if (prev === undefined) {
    return [{ field, kind: "added", next: fmtMaybeSecret(next) }];
  }
  if (next === undefined) {
    return [{ field, kind: "removed", prev: fmtMaybeSecret(prev) }];
  }
  if (isMasked(prev) && isMasked(next)) {
    return [{ field, kind: "secret-changed" }];
  }
  return [{ field, kind: "changed", prev: fmtMaybeSecret(prev), next: fmtMaybeSecret(next) }];
}

const WorkspaceRefSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
});

export const AuditLogItemSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  severity: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  workspace: WorkspaceRefSchema.nullable().optional(),
  userId: z.string().nullable().optional(),
  objectId: z.string().nullable().optional(),
  authType: z.string().nullable().optional(),
  tokenId: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  requestHeaders: z.record(z.string()).nullable().optional(),
  token: z
    .object({
      id: z.string(),
      type: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  changes: z.any().nullable().optional(),
  diff: z
    .array(
      z.object({
        field: z.string(),
        kind: z.enum(["added", "removed", "changed", "secret-changed", "noop"]),
        prev: z.string().optional(),
        next: z.string().optional(),
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

export const AuditLogListResultSchema = z.object({
  items: z.array(AuditLogItemSchema),
  nextCursor: z.string().optional(),
});

export type AuditLogItem = z.infer<typeof AuditLogItemSchema>;
export type AuditLogListResult = z.infer<typeof AuditLogListResultSchema>;

export const AUDIT_LOG_ORIGINS = ["ui", "api", "cli", "mcp"] as const;
export type AuditLogOrigin = (typeof AUDIT_LOG_ORIGINS)[number];

export const AUDIT_LOG_DEFAULT_LIMIT = 50;
export const AUDIT_LOG_MAX_LIMIT = 200;

export type AuditLogQuery = {
  /**
   * Workspace id or slug. When provided, scope to that workspace and require
   * `manageUsers` in it. When absent, scope is "all workspaces" and requires a
   * platform admin.
   */
  workspaceId?: string;
  /** Comma-separated event types (e.g. `config-object-update,auth-login`). */
  type?: string;
  /** Comma-separated severities. */
  severity?: string;
  /** Comma-separated subset of ui | api | cli | mcp. */
  origin?: string;
  from?: Date;
  to?: Date;
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string;
  /** Page size, 1..200 (default 50). */
  limit?: number;
};

export interface AuditLogServiceDeps {
  prisma: PrismaClient;
}

/**
 * Read side of the audit log, shared by the `/api/audit-log` route and the MCP
 * `get_audit_log` tool so that access checks, secret masking and the
 * prev/next → `diff` reduction live in exactly one place.
 */
export class AuditLogService {
  private readonly prisma: PrismaClient;

  constructor(deps: AuditLogServiceDeps) {
    this.prisma = deps.prisma;
  }

  async list(user: SessionUser, query: AuditLogQuery): Promise<AuditLogListResult> {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? AUDIT_LOG_DEFAULT_LIMIT), 1), AUDIT_LOG_MAX_LIMIT);
    const where: Prisma.AuditLogWhereInput = {};

    if (query.workspaceId) {
      // Resolve slug → id, then enforce owner-only access.
      const ws = await this.prisma.workspace.findFirst({
        where: { OR: [{ id: query.workspaceId }, { slug: query.workspaceId }] },
      });
      const workspaceId = ws?.id ?? query.workspaceId;
      await verifyAccessWithRole(user, workspaceId, "manageUsers");

      // Auth (login/logout) is workspace-agnostic — those rows are persisted
      // with `workspaceId = null`. Surface them in the workspace-scoped view
      // by also matching auth rows whose userId is a current member of this
      // workspace. Otherwise the UI shows `auth-login` / `auth-logout` filter
      // chips that can never produce results.
      const memberIds = (
        await this.prisma.workspaceAccess.findMany({
          where: { workspaceId },
          select: { userId: true },
        })
      ).map(m => m.userId);
      const baseOr: Prisma.AuditLogWhereInput[] = [{ workspaceId }];
      if (memberIds.length > 0) {
        baseOr.push({
          workspaceId: null,
          type: { in: ["auth-login", "auth-logout"] },
          userId: { in: memberIds },
        });
      }
      Object.assign(where, { OR: baseOr });
    } else {
      // Cross-workspace view — admin only.
      await verifyAdmin(user);
    }

    if (query.type) {
      where.type = { in: query.type.split(",").filter(Boolean) };
    }
    if (query.severity) {
      where.severity = { in: query.severity.split(",").filter(Boolean) };
    }
    if (query.origin) {
      const originClause = await this.buildOriginClause(query.origin);
      if (originClause) {
        const and = (where.AND as Prisma.AuditLogWhereInput[] | undefined) ?? [];
        and.push(originClause);
        where.AND = and;
      }
    }
    if (query.from || query.to) {
      where.timestamp = {};
      if (query.from) {
        (where.timestamp as Prisma.DateTimeFilter).gte = query.from;
      }
      if (query.to) {
        (where.timestamp as Prisma.DateTimeFilter).lte = query.to;
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

    const rows = await this.prisma.auditLog.findMany({
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
      ? await this.prisma.userProfile.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const actorById = new Map(actors.map(a => [a.id, a]));

    // Bulk-fetch workspace info for the page (admin view needs name + slug to
    // render the Workspace column; the workspace-scoped view doesn't need it
    // but the cost is a single small query).
    const workspaceIds = Array.from(new Set(page.map(r => r.workspaceId).filter((v): v is string => !!v)));
    const workspaces = workspaceIds.length
      ? await this.prisma.workspace.findMany({
          where: { id: { in: workspaceIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const workspaceById = new Map(workspaces.map(w => [w.id, w]));

    // Bulk-fetch token metadata for rows that were authored via bearer auth.
    const tokenIds = Array.from(new Set(page.map(r => r.tokenId).filter((v): v is string => !!v)));
    const tokens = tokenIds.length
      ? await this.prisma.userApiToken.findMany({
          where: { id: { in: tokenIds } },
          select: { id: true, type: true, name: true },
        })
      : [];
    const tokenById = new Map(tokens.map(t => [t.id, t]));

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
      ? await this.prisma.configurationObjectLink.findMany({
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

    const items: AuditLogItem[] = await Promise.all(
      page.map(async r => {
        const rawChanges = (r.changes as any) || {};
        const isRedacted = rawChanges._redacted === true;
        const summary = pickSummary(rawChanges) || ({} as Record<string, any>);

        if (!summary.objectName && r.type.startsWith("config-object-")) {
          const fromNew = (rawChanges.newVersion as any)?.name;
          const fromPrev = (rawChanges.prevVersion as any)?.name;
          if (typeof fromNew === "string" && fromNew) {
            summary.objectName = fromNew;
          } else if (typeof fromPrev === "string" && fromPrev) {
            summary.objectName = fromPrev;
          }
        }
        if (summary.objectType === "link" && r.objectId && linkNameById.has(r.objectId)) {
          summary.objectName = linkNameById.get(r.objectId);
        }

        const finalChanges = Object.keys(summary).length > 0 ? summary : null;

        let diff: DiffEntry[] | undefined;
        if (r.type.startsWith("config-object-")) {
          const objectType = (rawChanges.objectType as string) || "";
          let prevRaw = rawChanges.prevVersion;
          let nextRaw = rawChanges.newVersion;
          if (!isRedacted && objectType) {
            [prevRaw, nextRaw] = await Promise.all([
              applyOutputFilter(objectType, prevRaw),
              applyOutputFilter(objectType, nextRaw),
            ]);
          }
          const prev = prevRaw !== undefined ? stripDiffNoise(genericScrub(prevRaw)) : undefined;
          const next = nextRaw !== undefined ? stripDiffNoise(genericScrub(nextRaw)) : undefined;
          if (prev !== undefined || next !== undefined) {
            diff = flattenDiff(prev, next);
          }
          // Splice in `secret-changed` entries the differ couldn't recover —
          // these are paths where the underlying secret rotated but the
          // masked output ended up identical (or stripped) on both sides, so
          // the masked diff has no signal. The list was computed at write
          // time when raw was still available.
          const rotated = Array.isArray(rawChanges._rotatedSecrets) ? (rawChanges._rotatedSecrets as string[]) : [];
          if (rotated.length > 0) {
            const seen = new Set((diff || []).map(d => d.field));
            const synthetic: DiffEntry[] = rotated
              .filter(p => !seen.has(p))
              .map(p => ({ field: p, kind: "secret-changed" as const }));
            diff = [...(diff || []), ...synthetic];
          }
          if (diff && diff.length === 0 && r.type === "config-object-update") {
            diff = [{ field: "(none)", kind: "noop" }];
          }
        }

        const ws = r.workspaceId ? workspaceById.get(r.workspaceId) : undefined;

        const token = r.tokenId ? tokenById.get(r.tokenId) ?? null : null;

        return {
          id: r.id,
          timestamp: r.timestamp.toISOString(),
          type: r.type,
          severity: r.severity ?? null,
          workspaceId: r.workspaceId ?? null,
          workspace: ws ? { id: ws.id, name: ws.name, slug: ws.slug } : null,
          userId: r.userId ?? null,
          objectId: r.objectId ?? null,
          authType: r.authType ?? null,
          tokenId: r.tokenId ?? null,
          ip: r.ip ?? null,
          requestHeaders: (r.requestHeaders as Record<string, string> | null) ?? null,
          token,
          changes: finalChanges,
          diff,
          actor: r.userId ? actorById.get(r.userId) ?? null : null,
        };
      })
    );

    return { items, nextCursor };
  }

  /**
   * Translate each requested origin into a DB predicate that mirrors
   * originFromAuth() (lib/schema). There is no `origin` column: UI is any
   * non-bearer/non-mcp authType; the CLI/API split follows originFromAuth,
   * which treats a bearer token as CLI when its UserApiToken.type is "cli"
   * OR its id has the jitsu-cli- prefix. The prefix is stored on
   * AuditLog.tokenId, but `type` lives on UserApiToken with no relation to
   * join — so for cli/api we additionally resolve the (normally empty) set
   * of type="cli" tokens whose id lacks the prefix, keeping the filter
   * consistent with how the table classifies/renders those rows. The caller
   * attaches the returned OR via `where.AND` so it composes with the
   * workspace/cursor `OR`.
   */
  private async buildOriginClause(origin: string): Promise<Prisma.AuditLogWhereInput | undefined> {
    const CLI_PREFIX = "jitsu-cli-";
    const requested = origin.split(",").filter(Boolean);
    const unknown = requested.filter(o => !(AUDIT_LOG_ORIGINS as readonly string[]).includes(o));
    if (unknown.length > 0) {
      throw new ApiError(`Unknown origin(s): ${unknown.join(", ")}. Expected one of ${AUDIT_LOG_ORIGINS.join(", ")}`, {
        status: 400,
      });
    }
    // Tokens the console never mints this way (its CLI endpoint sets both the
    // prefix and type), but /api/user/keys allows type:"cli" with a random id.
    let unprefixedCliTokenIds: string[] = [];
    if (requested.includes("cli") || requested.includes("api")) {
      const rows = await this.prisma.userApiToken.findMany({
        where: { type: "cli", NOT: { id: { startsWith: CLI_PREFIX } } },
        select: { id: true },
      });
      unprefixedCliTokenIds = rows.map(r => r.id);
    }
    // A bearer row is CLI iff its tokenId is prefixed or in the resolved set.
    const cliTokenMatch: Prisma.AuditLogWhereInput[] = [
      { tokenId: { startsWith: CLI_PREFIX } },
      ...(unprefixedCliTokenIds.length ? [{ tokenId: { in: unprefixedCliTokenIds } }] : []),
    ];
    const notCliToken: Prisma.AuditLogWhereInput[] = [
      { tokenId: { not: { startsWith: CLI_PREFIX } } },
      ...(unprefixedCliTokenIds.length ? [{ tokenId: { notIn: unprefixedCliTokenIds } }] : []),
    ];
    // An explicit X-Jitsu-Client: jitsu-cli/… header stored on the row makes
    // it CLI regardless of token type — mirrors originFromAuth, which checks
    // this header first. Legacy rows (requestHeaders NULL) simply don't match,
    // so they keep classifying by token identity.
    // Mirror originFromAuth exactly: case-insensitive "jitsu-cli/" prefix (the
    // trailing slash is the delimiter that keeps "jitsu-client/…" from being
    // mis-attributed to CLI).
    const cliHeaderMatch: Prisma.AuditLogWhereInput = {
      requestHeaders: { path: ["x-jitsu-client"], string_starts_with: "jitsu-cli/", mode: "insensitive" },
    };
    // NULL-safe negation of cliHeaderMatch. A plain `NOT cliHeaderMatch` is
    // wrong here: for rows where requestHeaders is SQL NULL, or the
    // x-jitsu-client key is absent, the JSON-path predicate is SQL NULL, and
    // `NOT NULL` is NULL (not TRUE) — so those rows would be dropped from the
    // api/ui/mcp filters. That's every legacy row and every non-CLI request.
    // Enumerate the "not a CLI-header row" cases explicitly instead:
    const notCliHeader: Prisma.AuditLogWhereInput = {
      OR: [
        { requestHeaders: { equals: Prisma.DbNull } }, // no headers stored (legacy rows)
        { requestHeaders: { path: ["x-jitsu-client"], equals: Prisma.AnyNull } }, // key absent
        { NOT: cliHeaderMatch }, // present, but not a jitsu-cli/ value
      ],
    };
    const originClauses: Prisma.AuditLogWhereInput[] = [];
    for (const o of requested as AuditLogOrigin[]) {
      switch (o) {
        case "mcp":
          originClauses.push({ AND: [{ authType: "mcp" }, notCliHeader] });
          break;
        case "ui":
          // notIn also excludes NULL authType (SQL IN semantics), which is
          // correct: those rows render with no origin, not "UI".
          originClauses.push({ AND: [{ authType: { notIn: ["bearer", "mcp"] } }, notCliHeader] });
          break;
        case "cli":
          // Either the explicit client header, or a bearer request with a CLI token.
          originClauses.push({ OR: [cliHeaderMatch, { authType: "bearer", OR: cliTokenMatch }] });
          break;
        case "api":
          // Bearer, minus CLI (neither the header nor a CLI token). A bearer
          // row with no tokenId (service-account token) resolves to "API" on
          // the client, so include tokenId=null.
          originClauses.push({
            AND: [{ authType: "bearer" }, notCliHeader, { OR: [{ tokenId: null }, { AND: notCliToken }] }],
          });
          break;
      }
    }
    return originClauses.length > 0 ? { OR: originClauses } : undefined;
  }
}
