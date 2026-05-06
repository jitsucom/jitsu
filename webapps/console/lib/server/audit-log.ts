import { db } from "./db";
import { SessionUser } from "../schema";
import { getServerEnv } from "./serverEnv";
import { getServerLog } from "./log";
import { dispatchAccountAlert, AccountAlertEvent } from "./account-alerts";
import { AccountAlertEventType } from "../../emails/account-alert";

const enableAuditLog = getServerEnv().CONSOLE_ENABLE_AUDIT_LOG;

const log = getServerLog("audit-log");

export type AuthOp = "login" | "logout";
export type MembershipOp = "invited" | "joined" | "removed" | "role-changed";

// Inlined to avoid pulling lib/schema/destinations (which transitively imports
// lib/api.ts) at module-load time — that creates a cycle through nextauth.config.
const MASKED_SECRET = "__MASKED_BY_JITSU__";

function pickObjectName(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = obj.name ?? obj.title ?? obj.slug;
  return typeof v === "string" ? v : undefined;
}

// Field-name patterns that we always mask, regardless of schema. This is a
// defense-in-depth net for object types that don't have a registered
// `outputFilter` (notably `link` and `profilebuilder`) and for cases where a
// user tucked a credential into a free-form field. False positives are fine —
// the audit log is for "what changed", not "what was the value".
const SENSITIVE_KEY_PATTERN =
  /^(.*(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|private[_-]?key|client[_-]?secret|webhook[_-]?secret|auth(orization)?)|token)$/i;

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

// Lazy — config-objects.ts pulls a chain that loops back to lib/api.ts. We must
// not require it at module-load time. Cache after first hit.
let configObjectsModule: typeof import("../schema/config-objects") | null = null;
function loadConfigObjects(): typeof import("../schema/config-objects") {
  if (!configObjectsModule) {
    configObjectsModule = require("../schema/config-objects");
  }
  return configObjectsModule!;
}

function isPlainObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function jsonEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Walk raw prev/next and the masked counterparts side-by-side. Emit a path for
 * every leaf where raw values differ but masked values collapse to equal
 * (either both MASKED or both stripped/undefined). These are secret rotations
 * that the read-time differ would otherwise hide entirely — the masked-vs-
 * masked leaf branch is unreachable when the surrounding diff happens after
 * masking. We persist the list at write time (when raw is still available)
 * and recover `secret-changed` entries on read.
 */
function findSecretRotations(rawPrev: any, rawNext: any, maskedPrev: any, maskedNext: any, base = ""): string[] {
  if (jsonEqual(rawPrev, rawNext)) return [];

  if (isPlainObject(rawPrev) || isPlainObject(rawNext)) {
    const keys = new Set<string>([
      ...(isPlainObject(rawPrev) ? Object.keys(rawPrev) : []),
      ...(isPlainObject(rawNext) ? Object.keys(rawNext) : []),
    ]);
    const out: string[] = [];
    for (const k of keys) {
      const path = base ? `${base}.${k}` : k;
      out.push(
        ...findSecretRotations(
          isPlainObject(rawPrev) ? rawPrev[k] : undefined,
          isPlainObject(rawNext) ? rawNext[k] : undefined,
          isPlainObject(maskedPrev) ? maskedPrev[k] : undefined,
          isPlainObject(maskedNext) ? maskedNext[k] : undefined,
          path
        )
      );
    }
    return out;
  }

  if (Array.isArray(rawPrev) || Array.isArray(rawNext)) {
    const prevArr = Array.isArray(rawPrev) ? rawPrev : [];
    const nextArr = Array.isArray(rawNext) ? rawNext : [];
    const len = Math.max(prevArr.length, nextArr.length);
    const out: string[] = [];
    for (let i = 0; i < len; i++) {
      out.push(
        ...findSecretRotations(
          prevArr[i],
          nextArr[i],
          Array.isArray(maskedPrev) ? maskedPrev[i] : undefined,
          Array.isArray(maskedNext) ? maskedNext[i] : undefined,
          `${base}[${i}]`
        )
      );
    }
    return out;
  }

  // Leaf: raw differs. If masked sides also differ, the read-time differ will
  // already render this as `changed` — nothing to do. If they collapsed to
  // equal (or both undefined because outputFilter stripped the path), we
  // record the path so the reader can emit `secret-changed`.
  if (jsonEqual(maskedPrev, maskedNext)) {
    return [base || "(root)"];
  }
  return [];
}

async function redactForAudit(type: string, obj: any): Promise<any> {
  if (obj == null || typeof obj !== "object") return obj;
  let masked = obj;
  try {
    const { getAllConfigObjectTypeNames, getConfigObjectType } = loadConfigObjects();
    if (getAllConfigObjectTypeNames().includes(type)) {
      // outputFilter is the canonical "safe to expose" view: for destinations and
      // services it replaces secret-marked fields with MASKED_SECRET; for streams
      // it strips key plaintext/hash. Reusing it keeps the audit log in sync with
      // how the same object is rendered in the editor UI.
      masked = await getConfigObjectType(type).outputFilter(obj);
    }
  } catch (err) {
    log
      .atWarn()
      .withCause(err as Error)
      .log(`outputFilter failed for type=${type}; falling back to generic scrub only`);
    masked = obj;
  }
  // Belt and suspenders: also run the name-based scrubber. For unregistered types
  // (link, profilebuilder, etc.) this is the only line of defense.
  return genericScrub(masked);
}

/**
 * Audit-log helper for config-object mutations.
 *
 * SECURITY: Config objects (destinations, services, links, etc.) routinely
 * contain secrets — API keys, passwords, OAuth tokens, etc. We mask sensitive
 * fields before persisting using the same `outputFilter` the editor UI sees,
 * plus a generic name-based scrubber for types without a registered filter.
 *
 * Rows written by this helper are tagged with `_redacted: true`. The read API
 * gates exposure of `prevVersion` / `newVersion` on that flag, so any
 * pre-existing rows (written before this fix) are not exposed.
 */
export async function configObjectAuditLog(
  user: SessionUser,
  workspaceId: string,
  id: string,
  type: string,
  op: "create" | "update" | "delete",
  changes: { prevVersion?: any; newVersion?: any }
) {
  if (enableAuditLog) {
    const objectName = pickObjectName(changes.newVersion) ?? pickObjectName(changes.prevVersion);
    const [prevVersion, newVersion] = await Promise.all([
      redactForAudit(type, changes.prevVersion),
      redactForAudit(type, changes.newVersion),
    ]);
    // Identify secret rotations BEFORE we drop the raw values. Without this,
    // a rotation that doesn't change anything else becomes invisible (masked
    // prev === masked next → empty diff). We only do this for updates where
    // both sides are present.
    const rotatedSecrets =
      op === "update" && changes.prevVersion != null && changes.newVersion != null
        ? findSecretRotations(changes.prevVersion, changes.newVersion, prevVersion, newVersion)
        : [];
    await db.prisma().auditLog.create({
      data: {
        type: `config-object-${op}`,
        severity: "info",
        workspaceId,
        objectId: id,
        userId: user.internalId,
        authType: user.authType,
        changes: {
          _redacted: true,
          objectType: type,
          objectName,
          prevVersion,
          newVersion,
          ...(rotatedSecrets.length > 0 ? { _rotatedSecrets: rotatedSecrets } : {}),
        },
      },
    });
  }
}

export async function authAuditLog(
  user: Pick<SessionUser, "internalId" | "email" | "name">,
  op: AuthOp,
  authType: string,
  workspaceId?: string
): Promise<void> {
  if (!enableAuditLog) {
    return;
  }
  // No dedup here — call sites are expected to fire only on the actual
  // sign-in / sign-out user action. For Firebase that's the explicit
  // `signIn` / `signInWith` flow; the periodic ID-token rotation goes
  // through `create-session` which no longer logs.
  try {
    await db.prisma().auditLog.create({
      data: {
        type: `auth-${op}`,
        severity: "info",
        workspaceId: workspaceId ?? null,
        userId: user.internalId,
        authType,
        changes: {
          email: user.email,
          name: user.name,
        },
      },
    });
  } catch (err) {
    log.atError().withCause(err).log(`Failed to write auth audit log (${op}, ${authType})`);
  }
  // auth events are info severity — no email dispatch.
}

const membershipEventToType: Record<MembershipOp, AccountAlertEventType> = {
  invited: "member-invited",
  joined: "member-joined",
  removed: "member-removed",
  "role-changed": "member-role-changed",
};

export async function membershipAuditLog(
  actor: Pick<SessionUser, "internalId" | "email" | "name" | "authType"> | null,
  workspaceId: string,
  op: MembershipOp,
  target: { userId?: string; email?: string },
  changes?: { prevRole?: string; newRole?: string }
): Promise<void> {
  if (!enableAuditLog) {
    return;
  }
  const type = `member-${op}`;
  const occurredAt = new Date();
  try {
    await db.prisma().auditLog.create({
      data: {
        type,
        severity: "security",
        workspaceId,
        userId: actor?.internalId ?? null,
        objectId: target.userId ?? null,
        authType: actor?.authType ?? null,
        timestamp: occurredAt,
        changes: {
          actorEmail: actor?.email,
          targetUserId: target.userId,
          targetEmail: target.email,
          prevRole: changes?.prevRole,
          newRole: changes?.newRole,
        },
      },
    });
  } catch (err) {
    log.atError().withCause(err).log(`Failed to write membership audit log (${type})`);
    return;
  }

  // Fire-and-forget email dispatch — never let mail problems break the user flow.
  const event: AccountAlertEvent = {
    eventType: membershipEventToType[op],
    workspaceId,
    occurredAt,
    actorEmail: actor?.email,
    actorName: actor?.name,
    targetEmail: target.email,
    prevRole: changes?.prevRole,
    newRole: changes?.newRole,
  };
  dispatchAccountAlert(event).catch(err => {
    log.atError().withCause(err).log(`Account alert dispatch failed for ${type}`);
  });
}

export async function workspaceAuditLog(
  actor: Pick<SessionUser, "internalId" | "email" | "name" | "authType">,
  workspaceId: string,
  op: "updated" | "deleted",
  changes?: { prevVersion?: any; newVersion?: any; workspaceName?: string }
): Promise<void> {
  if (!enableAuditLog) {
    return;
  }
  const type = `workspace-${op}`;
  const severity = op === "deleted" ? "security" : "info";
  const occurredAt = new Date();
  try {
    await db.prisma().auditLog.create({
      data: {
        type,
        severity,
        workspaceId,
        userId: actor.internalId,
        authType: actor.authType,
        timestamp: occurredAt,
        changes: {
          actorEmail: actor.email,
          ...changes,
        },
      },
    });
  } catch (err) {
    log.atError().withCause(err).log(`Failed to write workspace audit log (${type})`);
    return;
  }

  if (severity === "security") {
    const event: AccountAlertEvent = {
      eventType: "workspace-deleted",
      workspaceId,
      occurredAt,
      actorEmail: actor.email,
      actorName: actor.name,
    };
    dispatchAccountAlert(event).catch(err => {
      log.atError().withCause(err).log(`Account alert dispatch failed for ${type}`);
    });
  }
}
