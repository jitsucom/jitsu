import { db } from "./db";
import { clickhouse } from "./clickhouse";
import { SyncService } from "./sync-service";
import { DebugService } from "./debug-service";
import { ReportsService } from "./reports-service";

// Lazy per-process instances of the shared service classes, bound to the
// db/clickhouse singletons — for HTTP route handlers. The MCP server wires
// its own instances through McpServerDeps.

let sync: SyncService | undefined;
export const syncService = () => (sync ??= new SyncService({ prisma: db.prisma(), pgPool: db.pgPool(), clickhouse }));

let debug: DebugService | undefined;
export const debugService = () => (debug ??= new DebugService({ prisma: db.prisma() }));

let reports: ReportsService | undefined;
export const reportsService = () =>
  (reports ??= new ReportsService({ prisma: db.prisma(), pgPool: db.pgPool(), clickhouse }));
