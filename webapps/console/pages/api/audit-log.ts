import { createRoute } from "../../lib/api";
import { z } from "zod";
import { auditLogService } from "../../lib/server/route-services";
import { AUDIT_LOG_MAX_LIMIT, AuditLogListResultSchema } from "../../lib/server/audit-log-service";

// Thin HTTP wrapper over AuditLogService — the MCP `get_audit_log` tool calls
// the same service, so access checks, secret scrubbing and the diff reduction
// are implemented once (lib/server/audit-log-service.ts).
export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      // Optional: when provided, scope to a single workspace and require
      // `manageUsers` in it. When absent, scope is "all workspaces" and
      // requires admin.
      workspaceId: z.string().optional(),
      type: z.string().optional(),
      severity: z.string().optional(),
      // Comma-separated subset of "ui" | "api" | "cli" | "mcp".
      origin: z.string().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(AUDIT_LOG_MAX_LIMIT).optional(),
    }),
    result: AuditLogListResultSchema,
  })
  .handler(async ({ user, query }) => auditLogService().list(user, query))
  .toNextApiHandler();
