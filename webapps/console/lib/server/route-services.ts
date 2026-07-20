import once from "lodash/once";
import { db } from "./db";
import { clickhouse } from "./clickhouse";
import { SyncService } from "./sync-service";
import { DebugService } from "./debug-service";
import { ReportsService } from "./reports-service";

// Lazy per-process instances of the shared service classes, bound to the
// db/clickhouse singletons — for HTTP route handlers. The MCP server wires
// its own instances through McpServerDeps.

export const syncService = once(() => new SyncService({ prisma: db.prisma(), pgPool: db.pgPool(), clickhouse }));

export const debugService = once(() => new DebugService({ prisma: db.prisma() }));

export const reportsService = once(() => new ReportsService({ prisma: db.prisma(), pgPool: db.pgPool(), clickhouse }));
