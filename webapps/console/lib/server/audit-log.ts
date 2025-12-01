import { db } from "./db";
import { SessionUser } from "../schema";
import { getServerEnv } from "./serverEnv";

const enableAuditLog = getServerEnv().CONSOLE_ENABLE_AUDIT_LOG;

export async function configObjectAuditLog(
  user: SessionUser,
  workspaceId: string,
  id: string,
  type: string,
  op: "create" | "update" | "delete",
  changes: { prevVersion?: any; newVersion?: any }
) {
  if (enableAuditLog) {
    await db.prisma().auditLog.create({
      data: {
        type: `config-object-${op}`,
        workspaceId,
        objectId: id,
        userId: user.internalId,
        authType: user.authType,
        changes: {
          objectType: type,
          prevVersion: changes.prevVersion,
          newVersion: changes.newVersion,
        },
      },
    });
  }
}
