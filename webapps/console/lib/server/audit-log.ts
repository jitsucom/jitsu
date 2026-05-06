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

function pickObjectName(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = obj.name ?? obj.title ?? obj.slug;
  return typeof v === "string" ? v : undefined;
}

/**
 * Audit-log helper for config-object mutations.
 *
 * SECURITY: Config objects (destinations, services, links, etc.) routinely contain
 * secrets — API keys, passwords, OAuth tokens, etc. — that must never be persisted
 * to the audit log. We therefore intentionally drop `prevVersion` / `newVersion` and
 * persist only the object's type and human-readable name. The signature still accepts
 * the versions so callers don't need to change, but the values are not stored.
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
    await db.prisma().auditLog.create({
      data: {
        type: `config-object-${op}`,
        severity: "info",
        workspaceId,
        objectId: id,
        userId: user.internalId,
        authType: user.authType,
        changes: {
          objectType: type,
          objectName,
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
