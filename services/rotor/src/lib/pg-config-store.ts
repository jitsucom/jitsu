import { EnrichedConnectionConfig } from "@jitsu-internal/console/lib/server/fast-store";
import { createInMemoryStore } from "./inmem-store";
import { Pool, PoolClient } from "pg";
import { assertDefined, getLog, namedParameters, newError } from "juava";
import Cursor from "pg-cursor";
import omit from "lodash/omit";
import hash from "object-hash";

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
  // TODO: remove this to console's prisma migration
  setImmediate(() =>
    pool.query(`create or replace view enriched_connections_push as select link.id as "id",
       json_build_object('id', link.id,
                         'workspaceId', ws.id,
                         'destinationId', dst.id,
                         'streamId', src.id,
                         'usesBulker', link."data" ?& array['mode', 'dataLayout'] ,
                         'type', dst."config" ->> 'destinationType',
                         'options', link.data,
                         'updatedAt', to_char(link."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                         'credentials', dst.config,
                         'credentialsHash', md5(dst.config::text)
       )       as "enrichedConnection"
from "ConfigurationObjectLink" link
         join "Workspace" ws on link."workspaceId" = ws.id and ws.deleted = false
         join "ConfigurationObject" dst
              on dst.id = link."toId" and dst.type = 'destination' and dst."workspaceId" = link."workspaceId" and
                 dst.deleted = false
         join "ConfigurationObject" src
              on src.id = link."fromId" and src.type = 'stream' and
                 src."workspaceId" = link."workspaceId" and src.deleted = false
where link.deleted = false`)
  );
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
  let client: PoolClient | undefined = undefined;
  let totalRows = 0;
  try {
    client = await pg.connect();
    cursor = client.query(new Cursor(parsedQuery.query, parsedQuery.values));
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
      await cursor.close().then(() => {
        client?.release();
      });
    } else if (client) {
      client.release();
    }
  }
}

export type ConfigStore = {
  getConfig: (type: string, key: string) => any | undefined;
  getEnrichedConnection: (connectionId: string) => EnrichedConnectionConfig | undefined;
  toJSON: () => string;
  enabled: boolean;
};

const DummyStore: ConfigStore = {
  enabled: false,
  getConfig: () => undefined,
  getEnrichedConnection: () => undefined,
  toJSON: () => "",
};

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
        ...row.config,
        codeHash: hash(row.config?.code),
      };
    });

    await stream(pg, `select * from enriched_connections_push`, [], row => {
      connections[row.id] = row["enrichedConnection"];
    });
    return {
      enabled: true,
      getConfig: <T>(type: string, key: string) => {
        const config = configs[type]?.[key];
        if (config) {
          return config as T;
        }
      },
      getEnrichedConnection: (connectionId: string) => {
        const c = connections[connectionId];
        if (c) {
          return c as EnrichedConnectionConfig;
        }
      },
      toJSON: () => {
        return JSON.stringify({
          configs,
          connections,
        });
      },
    };
  } else {
    return DummyStore;
  }
}

export const pgConfigStore = createInMemoryStore({
  refreshIntervalMillis: process.env.PG_CONFIG_REFRESH_INTERVAL_MS
    ? parseInt(process.env.PG_CONFIG_REFRESH_INTERVAL_MS)
    : 2000,
  name: "pg-config",
  localDir: process.env.PG_CONFIG_LOCAL_DIR,
  serializer: (store: ConfigStore) => (store.enabled ? store.toJSON() : ""),
  deserializer: (serialized: string) => {
    if (serialized) {
      const store = JSON.parse(serialized);
      return {
        enabled: true,
        getConfig: <T>(type: string, key: string): T => {
          return store.configs?.[type]?.[key];
        },
        getEnrichedConnection: (connectionId: string) => {
          return store.connections?.[connectionId];
        },
        toJSON: () => serialized,
      };
    } else {
      return DummyStore;
    }
  },
  refresh: refreshStore,
});
