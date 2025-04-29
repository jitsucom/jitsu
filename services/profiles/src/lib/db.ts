import { Pool, PoolClient } from "pg";
import Cursor from "pg-cursor";
import { getLog, getSingleton, hideSensitiveInfo, namedParameters, newError, requireDefined, stopwatch } from "juava";

export type Handler = (row: Record<string, any>) => Promise<void> | void;

//we will need to support named params in future
export type ParamValues = any[] | Record<string, any>;
const log = getLog("db");

export type ProfileBuilderState = {
  profileBuilderId: string;
  updatedAt?: Date;
  fullRebuildInfo?: any;
  queuesInfo?: any;
  metrics?: any;
};

export type ProfileBuilderFullRebuildInfo = {
  version: number;
  timestamp: Date;
  profilesCount: number;
};

export type ProfileBuilderQueueInfo = {
  intervalSec?: number;
  timestamp: Date;
  queues: Record<
    number,
    {
      priority: number;
      size: number;
      processed?: number;
    }
  >;
};

type PgHelper = {
  getProfileBuilderState(profileBuilderId: string): Promise<ProfileBuilderState | undefined>;
  updateProfileBuilderFullRebuildInfo(profileBuilderId: string, info: ProfileBuilderFullRebuildInfo): Promise<void>;
  updateProfileBuilderQueuesInfo(profileBuilderId: string, info: ProfileBuilderQueueInfo): Promise<void>;
  updateProfileBuilderMetrics(profileBuilderId: string, metrics: any): Promise<void>;
  streamQuery(query: string, values?: ParamValues | Handler, handler?: Handler | undefined): Promise<{ rows: number }>;
};

const pgHelper: PgHelper = {
  async getProfileBuilderState(profileBuilderId: string): Promise<ProfileBuilderState | undefined> {
    let rows = await db.pgPool().query(
      `select *
       from newjitsu."ProfileBuilderState2"
       where "profileBuilderId" = $1::text`,
      [profileBuilderId]
    );
    if (rows.rowCount) {
      return rows.rows[0];
    }
    return undefined;
  },
  async updateProfileBuilderFullRebuildInfo(profileBuilderId: string, info: ProfileBuilderFullRebuildInfo) {
    await db.pgPool().query(
      `
        insert into newjitsu."ProfileBuilderState2"
        values ($1, now(), $2, null, null)
        ON CONFLICT ON CONSTRAINT "ProfileBuilderState2_pkey" DO UPDATE SET "updatedAt"       = now(),
                                                                            "fullRebuildInfo" = $2`,
      [profileBuilderId, info]
    );
  },
  async updateProfileBuilderQueuesInfo(profileBuilderId: string, info: ProfileBuilderQueueInfo) {
    await db.pgPool().query(
      `
        insert into newjitsu."ProfileBuilderState2"
        values ($1, now(), null, $2, null)
        ON CONFLICT ON CONSTRAINT "ProfileBuilderState2_pkey" DO UPDATE SET "updatedAt"  = now(),
                                                                            "queuesInfo" = $2`,
      [profileBuilderId, info]
    );
  },
  async updateProfileBuilderMetrics(profileBuilderId: string, metrics: any) {
    await db.pgPool().query(
      `
        insert into newjitsu."ProfileBuilderState2"
        values ($1, now(), null, null, $2)
        ON CONFLICT ON CONSTRAINT "ProfileBuilderState2_pkey" DO UPDATE SET "updatedAt" = now(),
                                                                            "metrics"   = $2`,
      [profileBuilderId, metrics]
    );
  },
  async streamQuery(
    query: string,
    _values: ParamValues | Handler,
    _handler: Handler | undefined
  ): Promise<{ rows: number }> {
    const values = typeof _values === "function" ? undefined : _values;
    const handler =
      typeof _values === "function"
        ? _values
        : requireDefined(
            _handler,
            "handler is not defined. It should be passed as second 3rd argument of streamQuery()"
          );
    const { query: processedQuery, values: processedParams } = namedParameters(query, values || []);
    const sw = stopwatch();
    let totalRows = 0;
    let cursor: Cursor | undefined = undefined;
    const client: PoolClient = await db.pgPool().connect();
    try {
      cursor = client.query(new Cursor(processedQuery, processedParams));
      let rows = await cursor.read(100);
      while (rows.length > 0) {
        for (let i = 0; i < rows.length; i++) {
          await handler(rows[i]);
          totalRows++;
        }
        rows = await cursor.read(100);
      }
      let queryResult;

      queryResult = await db.pgPool().query(processedQuery, processedParams);
    } catch (e) {
      log
        .atError()
        .withCause(e)
        .log("Error executing query: \n" + processedQuery + "\n with params: " + JSON.stringify(processedParams));
      throw newError("Error executing the query. See query in logs", e);
    } finally {
      if (cursor) {
        await cursor.close(() => {
          client.release();
        });
      } else if (client) {
        client.release();
      }
    }

    log.atDebug().log(`Query executed in ${sw.elapsedMs()}ms: ${processedQuery}${processedParams}`);

    return { rows: totalRows };
  },
};

export const db = {
  pgPool: getSingleton<Pool>("pg", createPg),
  pgHelper: () => pgHelper,
} as const;

export type DatabaseConnection = typeof db;

export type PgSSLMode = "disable" | "prefer" | "require" | "no-verify";

export function createPg(): Pool {
  const connectionUrl = getApplicationDatabaseUrl();
  const parsedUrl = new URL(connectionUrl);
  const schema = parsedUrl.searchParams.get("schema");
  if (schema !== "newjitsu") {
    const tBorder = `┌─────────────────────────────────────────────────────────────────────┐`;
    const bBorder = `└─────────────────────────────────────────────────────────────────────┘`;
    const msg = [
      "\n",
      tBorder,
      `│ Jitsu requires to connect to the database with "newjitsu" schema`.padEnd(tBorder.length - 2, " ") + "│",
      bBorder,
    ].join("\n");
    log.atError().log(msg);
    throw new Error(`Invalid schema ${schema} in database connection URL. Expected 'newjitsu' schema.`);
  }
  const sslMode = parsedUrl.searchParams.get("sslmode") || ("disable" as PgSSLMode);
  if (sslMode === "require" || sslMode === "prefer") {
    throw new Error(`sslmode=${sslMode} is not supported`);
  }

  const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 600000,
    connectionString: requireDefined(process.env.DATABASE_URL, "env.DATABASE_URL is not defined"),
    ssl: sslMode === "no-verify" ? { rejectUnauthorized: false } : undefined,
    application_name: (parsedUrl.searchParams.get("application_name") || "console") + "-raw-pg",
  });
  pool.on("connect", async client => {
    log
      .atInfo()
      .log(
        `Connecting new client ${hideSensitiveInfo(connectionUrl)}. Pool stat: idle=${pool.idleCount}, waiting=${
          pool.waitingCount
        }, total=${pool.totalCount}` + (schema ? `. Default schema: ${schema}` : "")
      );
    //this is commented on purpose, it won't work for pgbouncer in transaction mode https://www.pgbouncer.org/features.html
    //let's leave it commented for information purposes
    // if (schema) {
    //   await client.query(`SET search_path TO "${schema}"`);
    // }
  });
  pool.on("error", error => {
    log.atError().withCause(error).log("Pool error");
  });
  return pool;
}

export function getApplicationDatabaseUrl(): string {
  return requireDefined(
    process.env.APP_DATABASE_URL || process.env.DATABASE_URL,
    "neither env.DATABASE_URL, nor env.APP_DATABASE_URL is not defined"
  );
}
