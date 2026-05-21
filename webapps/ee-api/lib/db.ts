import { requireDefined } from "juava";
import { PrismaClient } from "./generated/prisma";
import { getServerLog } from "./log";

export { Prisma } from "./generated/prisma";

const log = getServerLog("db");

function createPrisma(): PrismaClient {
  log.atInfo().log("Initializing Prisma client for the newjitsuee schema");
  return new PrismaClient({
    datasources: {
      db: { url: requireDefined(process.env.DATABASE_URL, "env DATABASE_URL is not defined") },
    },
  });
}

// Reuse one client across hot-reloads in dev: Next.js re-evaluates modules on
// HMR, and a fresh PrismaClient per reload would exhaust the connection pool.
const globalForPrisma = globalThis as unknown as { eeApiPrisma?: PrismaClient };

/**
 * Prisma client for ee-api's own tables, which all live in the `newjitsuee`
 * Postgres schema (see prisma/schema.prisma). Tables in the `newjitsu` schema
 * are owned by webapps/console's Prisma — query those through the raw `pg` pool
 * exported from lib/services.ts instead.
 */
export const prisma: PrismaClient = globalForPrisma.eeApiPrisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.eeApiPrisma = prisma;
}
