import { isTruish } from "../shared/chores";

export const enableAuditLog = isTruish(process.env.CONSOLE_ENABLE_AUDIT_LOG);
