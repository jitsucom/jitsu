import { EnrichedConnectionConfig } from "@jitsu-internal/console/lib/server/fast-store";
import { createInMemoryStore } from "./inmem-store";
import { Pool } from "pg";
import { assertDefined, getLog, namedParameters, newError } from "juava";
import Cursor from "pg-cursor";
import omit from "lodash/omit";

const log = getLog("pg-config-store");

export function createPg(): Pool | undefined {
  if (!process.env.CONFIG_STORE_DATABASE_URL) {
    return undefined;
  }
  const connectionUrl = process.env.CONFIG_STORE_DATABASE_URL;
  const parsedUrl = new URL(connectionUrl);
  const schema = parsedUrl.searchParams.get("schema");

  const sslMode = parsedUrl.searchParams.get("sslmode") || "disable";
  if (sslMode === "require" || sslMode === "prefer") {
    throw new Error(`sslmode=${sslMode} is not supported`);
  }

  const pool = new Pool({
    max: 4,
    min: 1,
    connectionString: connectionUrl,
    ssl: sslMode === "no-verify" ? { rejectUnauthorized: false } : undefined,
  });
  pool.on("connect", async client => {
    log
      .atInfo()
      .log(
        `Connecting new client ${connectionUrl}. Pool stat: idle=${pool.idleCount}, waiting=${pool.waitingCount}, total=${pool.totalCount}` +
          (schema ? `. Default schema: ${schema}` : "")
      );
    if (schema) {
      await client.query(`SET search_path TO "${schema}"`);
    }
  });
  pool.on("error", error => {
    log.atError().withCause(error).log("Pool error");
  });
  pool
    .connect()
    .then(() => {
      log.atInfo().log("Connected to postgres");
    })
    .catch(e => {
      log.atError().withCause(e).log("Connection to postgres failed, the app might be not operational");
    });
  return pool;
}

const pg = createPg();

/**
 * Duplicate of db.ts from webapps/console/lib/server/db.ts. Since we don't want to worsen the situation with rotor
 * being dependent on console, reimplementing the function here.
 */
async function stream(pg: Pool, query: string, params: any[], callback: (row: any) => Promise<void> | void) {
  const parsedQuery = namedParameters(query, params);
  let cursor: Cursor | undefined = undefined;
  let totalRows = 0;
  try {
    cursor = pg.query(new Cursor(parsedQuery.query, parsedQuery.values));
    let rows = await cursor.read(100);
    while (rows.length > 0) {
      for (let i = 0; i < rows.length; i++) {
        await callback(rows[i]);
        totalRows++;
      }
      rows = await cursor.read(100);
    }
  } catch (e) {
    log
      .atError()
      .withCause(e)
      .log("Error executing query: \n" + parsedQuery.query + "\n with params: " + JSON.stringify(parsedQuery.values));
    throw newError("Error executing the query. See query in logs", e);
  } finally {
    if (cursor) {
      await cursor.close();
    }
  }
}

export type StoreMethods = {
  getConfig: <T>(type: string, key: string) => T;
  getEnrichedConnection: (connectionId: string) => EnrichedConnectionConfig;
};

export type ConfigStore = ({ enabled: true } & StoreMethods) | { enabled: false };

export async function refreshStore(): Promise<ConfigStore> {
  if (process.env.CONFIG_STORE_DATABASE_URL) {
    const configs: Record<string, Record<string, any>> = {};
    const connections: Record<string, any> = {};
    assertDefined(pg);

    await stream(pg, `select * from "ConfigurationObject" where deleted is false and type in ('function')`, [], row => {
      const type = row.type;
      if (!configs[type]) {
        configs[type] = {};
      }
      configs[type][row.id] = {
        ...omit(row, "deleted", "config"),
        ...JSON.parse(row.config),
      };
    });

    return {
      enabled: true,
      getConfig: <T>(type: string, key: string): T => {
        const config = configs[type]?.[key];
        if (!config) {
          throw new Error(`Config for ${type}/${key} not found`);
        }
        return config as T;
      },
      getEnrichedConnection: (connectionId: string) => {
        return connections[connectionId] as EnrichedConnectionConfig;
      },
    };
  } else {
    return { enabled: false };
  }
}

export const pgConfigStore = createInMemoryStore({
  refreshIntervalMillis: process.env.PG_CONFIG_REFRESH_INTERVAL_MS
    ? parseInt(process.env.PG_CONFIG_REFRESH_INTERVAL_MS)
    : 2000,
  name: "pg-config",
  refresh: refreshStore,
});
