import { getErrorMessage, getLog } from "juava";
import * as PG from "pg";

const log = getLog("store");

/**
 * Key value table with hash-map interface
 */
export interface KeyValueTable {
  get(key: string): Promise<any | undefined>;

  put(key: string, obj: any, opts?: { ttlMs?: number }): Promise<void>;

  del(key: string): Promise<void>;
}

/**
 * A collection of key value tables
 */
declare interface KeyValueStore {
  getTable(tableName: string): KeyValueTable;
}

const schema = table => `
    CREATE TABLE IF NOT EXISTS ${table}
    (
      id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      obj JSONB NOT NULL default '{}'::jsonb,
      expire TIMESTAMP WITH TIME ZONE,
      primary key (id, namespace)
    );
    ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS id TEXT NOT NULL;
    ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL;
    ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS obj JSONB NOT NULL default '{}'::jsonb;
    ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS expire TIMESTAMP WITH TIME ZONE;
`;

const pl = table => `ALTER TABLE ${table} ADD PRIMARY KEY (id, namespace)`;

function expire(ttlMs: number): Date {
  let d = new Date(Date.now());
  d.setMilliseconds(d.getMilliseconds() + ttlMs);
  return d;
}

function deleteQuery(table: string, namespace: string, key: string) {
  return {
    text: `DELETE
           FROM ${table}
           WHERE namespace = $1
             AND id = $2`,
    values: [namespace, key],
  };
}

/**
 * Deletes expired objects once per 10 queries (approximately)
 */
function maybeDeleteExpiredObjects(pgPool, table) {
  if (Math.random() < 0.1) {
    let query = `select *
                 from ${table}
                 where expire <= NOW()`;
    log.atInfo().log(`Deleting expired objects: ${query}`);
    //no need to wait. It can be executed in asynchronous manner
    pgPool.query(query);
  }
}

function hideSensitiveInfo(url: string) {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.password = "****";
    return parsedUrl.toString();
  } catch (e) {
    return "***";
  }
}

export function createPg(url: string, opts: { defaultSchema?: string; connectionName?: string } = {}): PG.Pool {
  const parsedUrl = new URL(url);
  const schema = opts.defaultSchema || parsedUrl.searchParams.get("schema") || "public";
  const sslMode = parsedUrl.searchParams.get("sslmode") || "disable";
  if (sslMode === "require" || sslMode === "prefer") {
    throw new Error(`sslmode=${sslMode} is not supported`);
  }

  const pool = new PG.Pool({
    connectionString: url,
    ssl: sslMode === "no-verify" ? { rejectUnauthorized: false } : undefined,
  });
  pool.on("connect", async client => {
    log
      .atInfo()
      .log(
        `Connecting new client for ${hideSensitiveInfo(url)}${
          opts.connectionName ? ` - ${opts.connectionName}` : ""
        }. Pool stat: idle=${pool.idleCount}, waiting=${pool.waitingCount}, total=${pool.totalCount}` +
          (schema ? `. Default sc,hema: ${schema}` : ",")
      );
    if (schema) {
      await client.query(`SET search_path TO "${schema}"`);
    }
  });
  pool.on("error", error => {
    log.atError().withCause(error).log("Pool error");
  });
  return pool;
}

export async function getPostgresStore(
  postgres: string | PG.Pool,
  opts: { tableName?: string; schema?: string } = {}
): Promise<KeyValueStore> {
  const pgPool =
    typeof postgres === "string"
      ? await createPg(postgres, { defaultSchema: opts.schema, connectionName: "kvstore" })
      : postgres;
  const table = opts?.tableName || `kvstore`;
  try {
    await pgPool.query(schema(table));
  } catch (e: any) {
    log.atError().log(`Failed to initialize postgres table storage: ${getErrorMessage(e)} Query: schema(table)`);
    throw new Error("Failed to initialize postgres table storage: " + getErrorMessage(e));
  }

  return {
    getTable(tableName: string): KeyValueTable {
      return {
        async del(key: string) {
          maybeDeleteExpiredObjects(pgPool, table);
          await pgPool.query(deleteQuery(table, tableName, key));
        },
        async get(key: string) {
          maybeDeleteExpiredObjects(pgPool, table);
          let result = await pgPool.query({
            text: `SELECT obj, expire
                   FROM ${table}
                   WHERE namespace = $1
                     AND id = $2`,
            values: [tableName, key],
          });
          if (result.rows.length === 0) {
            return undefined;
          } else {
            const { expire, obj } = result.rows[0];
            if (expire && new Date(Date.now()).getTime() >= expire.getTime()) {
              log.atDebug().log(`Expiring ${tableName}/${key}. Expiration: ${expire}. Obj: `, obj);
              await pgPool.query(deleteQuery(table, tableName, key));
              return null;
            } else {
              return obj;
            }
          }
        },
        async put(key: string, obj: any, opts: { ttlMs?: number } = {}) {
          maybeDeleteExpiredObjects(pgPool, table);
          const upsertQuery = `
              INSERT INTO ${table} (id, namespace, obj, expire)
              VALUES ($1, $2, $3, $4) ON CONFLICT (id, namespace) DO
              UPDATE SET obj = $3,
                  expire=$4`;
          try {
            await pgPool.query({
              text: upsertQuery,
              values: [key, tableName, obj, opts.ttlMs ? expire(opts.ttlMs) : null],
            });
          } catch (e: any) {
            log
              .atError()
              .log(
                `Failed to run upsert query (${e.message}).\n\tDid you forget to add primary key by running '${pl(
                  table
                )}'?\n\nQuery: `,
                upsertQuery
              );
            throw new Error("Failed to initialize postgres table storage: " + e.message);
          }
        },
      };
    },
  };
}