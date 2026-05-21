import { assertDefined, hideSensitiveInfo } from "juava";
import * as PG from "pg";
import { prisma } from "./db";
import { getServerLog } from "./log";

const log = getServerLog("store");

/**
 * Key value table with hash-map interface
 */
export interface KeyValueTable {
  /**
   * List all keys in the table. If keyPattern is specified, only keys matching the pattern are returned.
   * @param keyPattern
   */
  listKeys(keyPattern?: string): Promise<string[]>;
  list(keyPattern?: string): Promise<{ id: string; obj: any }[]>;

  get(key: string): Promise<any | undefined>;

  put(key: string, obj: any, opts?: { ttlMs?: number }): Promise<void>;

  del(key: string): Promise<void>;

  clear(): Promise<number>;
}

/**
 * A collection of key value tables
 */
export interface KeyValueStore {
  getTable(tableName: string): KeyValueTable;
}

function expire(ttlMs: number): Date {
  const d = new Date(Date.now());
  d.setMilliseconds(d.getMilliseconds() + ttlMs);
  return d;
}

/**
 * Deletes expired objects once per 10 calls (approximately). Fire-and-forget —
 * the result is not awaited.
 */
function maybeDeleteExpiredObjects() {
  if (Math.random() < 0.1) {
    prisma.kvRecord
      .deleteMany({ where: { expire: { lte: new Date() } } })
      .catch(e => log.atWarn().withCause(e).log("Failed to delete expired kvstore objects"));
  }
}

/**
 * Creates a raw `pg` connection pool. Used for queries against the `newjitsu`
 * schema, which is owned by webapps/console's Prisma and not modeled here.
 */
export function createPg(url: string, opts: { defaultSchema?: string; connectionName?: string } = {}): PG.Pool {
  const parsedUrl = new URL(url);
  const schema = opts.defaultSchema || parsedUrl.searchParams.get("schema") || "public";
  const sslMode = parsedUrl.searchParams.get("sslmode") || "disable";

  const pool = new PG.Pool({
    connectionString: url,
    ssl: sslMode === "no-verify" ? { rejectUnauthorized: false } : undefined,
  });
  pool.on("connect", async () => {
    log
      .atInfo()
      .log(
        `Connecting new client for ${hideSensitiveInfo(url)}${
          opts.connectionName ? ` - ${opts.connectionName}` : ""
        }. Pool stat: idle=${pool.idleCount}, waiting=${pool.waitingCount}, total=${pool.totalCount}` +
          (schema ? `. Default schema: ${schema}` : ",")
      );
    //this is commented on purpose, it won't work for pgbouncer in transaction mode https://www.pgbouncer.org/features.html
    //let's leave it commented for information purposes
    //as a result, we need to use fully qualified table names
    // if (schema) {
    //   await client.query(`SET search_path TO "${schema}"`);
    // }
  });
  pool.on("error", error => {
    log.atError().withCause(error).log("Pool error");
  });
  return pool;
}

/**
 * Key-value store backed by the Prisma-managed `newjitsuee.kvstore` table.
 * Each `getTable(name)` exposes one logical table; rows are scoped by the
 * `namespace` column.
 */
export function getKvStore(): KeyValueStore {
  return {
    getTable(namespace: string): KeyValueTable {
      const key = (id: string) => ({ id_namespace: { id, namespace } });
      return {
        async clear() {
          const { count } = await prisma.kvRecord.deleteMany({ where: { namespace } });
          return count;
        },

        async list(keyPattern?: string) {
          assertDefined(!keyPattern, "keyPattern is not supported yet");
          maybeDeleteExpiredObjects();
          const rows = await prisma.kvRecord.findMany({
            where: { namespace, OR: [{ expire: null }, { expire: { gt: new Date() } }] },
            select: { id: true, obj: true },
          });
          return rows.map(({ id, obj }) => ({ id, obj }));
        },

        async listKeys(keyPattern?: string): Promise<string[]> {
          assertDefined(!keyPattern, "keyPattern is not supported yet");
          maybeDeleteExpiredObjects();
          const rows = await prisma.kvRecord.findMany({
            where: { namespace, OR: [{ expire: null }, { expire: { gt: new Date() } }] },
            select: { id: true },
          });
          return rows.map(({ id }) => id);
        },

        async del(id: string) {
          maybeDeleteExpiredObjects();
          await prisma.kvRecord.deleteMany({ where: { namespace, id } });
        },

        async get(id: string) {
          maybeDeleteExpiredObjects();
          const row = await prisma.kvRecord.findUnique({ where: key(id) });
          if (!row) {
            return undefined;
          }
          if (row.expire && row.expire.getTime() <= Date.now()) {
            log.atDebug().log(`Expiring ${namespace}/${id}. Expiration: ${row.expire}. Obj: `, row.obj);
            await prisma.kvRecord.deleteMany({ where: { namespace, id } });
            return null;
          }
          return row.obj;
        },

        async put(id: string, obj: any, opts: { ttlMs?: number } = {}) {
          maybeDeleteExpiredObjects();
          const data = { obj, expire: opts.ttlMs ? expire(opts.ttlMs) : null };
          await prisma.kvRecord.upsert({
            where: key(id),
            create: { id, namespace, ...data },
            update: data,
          });
        },
      };
    },
  };
}
