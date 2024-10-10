import { Pool, PoolClient } from "pg";
import Cursor from "pg-cursor";
import { getSingleton, namedParameters, newError, requireDefined, stopwatch, getLog } from "juava";

export type Handler = (row: Record<string, any>) => Promise<void> | void;

//we will need to support named params in future
export type ParamValues = any[] | Record<string, any>;
const log = getLog("db");

export type ProfileBuilderState = {
  profileBuilderId: string;
  profileBuilderVersion: number;
  instanceIndex: number;
  totalInstances: number;
  startedAt: Date;
  updatedAt?: Date;
  lastTimestamp?: Date;
  processedUsers: number;
  errorUsers: number;
  totalUsers: number;
  speed: number;
};

type PgHelper = {
  getProfileBuilderState(
    profileBuilderId: string,
    profileBuilderVersion: number,
    totalInstances: number,
    instanceIndex: number
  ): Promise<ProfileBuilderState | undefined>;
  updateProfileBuilderState(state: ProfileBuilderState);
  streamQuery(query: string, values?: ParamValues | Handler, handler?: Handler | undefined): Promise<{ rows: number }>;
};

const pgHelper: PgHelper = {
  async getProfileBuilderState(
    profileBuilderId: string,
    profileBuilderVersion: number,
    totalInstances: number,
    instanceIndex: number
  ): Promise<ProfileBuilderState | undefined> {
    let rows = await db.pgPool().query(
      `select * from newjitsu."ProfileBuilderState" where
                                               "profileBuilderId" = $1::text and
      "profileBuilderVersion" = $2::integer and
      "totalInstances" = $3::integer and
      "instanceIndex" = $4::integer`,
      [profileBuilderId, profileBuilderVersion, totalInstances, instanceIndex]
    );
    if (rows.rowCount) {
      return rows.rows[0];
    }
    rows = await db.pgPool().query(
      `select "profileBuilderId", "profileBuilderVersion", "totalInstances", count("instanceIndex"), min("lastTimestamp") as lastTimestamp 
from newjitsu."ProfileBuilderState" where
      "profileBuilderId" = $1::text and
      "profileBuilderVersion" = $2::integer
                                    group by "profileBuilderId", "profileBuilderVersion", "totalInstances"
                                    having "totalInstances"=count("instanceIndex")
                                    order by min("lastTimestamp") desc`,
      [profileBuilderId, profileBuilderVersion]
    );
    if (rows.rowCount) {
      const row = rows.rows[0];
      return {
        ...row,
        instanceIndex: -1,
        startedAt: new Date(),
        updatedAt: new Date(),
      };
    }
    return undefined;
  },
  async updateProfileBuilderState(state: ProfileBuilderState) {
    state.updatedAt = new Date();
    await db.pgPool().query(
      `
insert into newjitsu."ProfileBuilderState" as p ("profileBuilderId", "profileBuilderVersion","instanceIndex",
"totalInstances", "startedAt", "updatedAt", "lastTimestamp", "processedUsers", "errorUsers", "totalUsers", "speed")
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT ON CONSTRAINT "ProfileBuilderState_pkey" DO UPDATE SET
          "startedAt" = $5::timestamp,
          "updatedAt" = $6::timestamp,
          "lastTimestamp" = $7::timestamp,
          "processedUsers" = $8::integer,
          "errorUsers" = $9::integer,
          "totalUsers" = $10::integer,
          "speed" = $11::integer`,
      [
        state.profileBuilderId,
        state.profileBuilderVersion,
        state.instanceIndex,
        state.totalInstances,
        state.startedAt ?? new Date(),
        state.updatedAt ?? new Date(),
        state.lastTimestamp,
        state.processedUsers ?? 0,
        state.errorUsers ?? 0,
        state.totalUsers ?? 0,
        state.speed ?? 0,
      ]
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
    min: 3,
    idleTimeoutMillis: 600000,
    connectionString: requireDefined(process.env.DATABASE_URL, "env.DATABASE_URL is not defined"),
    ssl: sslMode === "no-verify" ? { rejectUnauthorized: false } : undefined,
    application_name: (parsedUrl.searchParams.get("application_name") || "console") + "-raw-pg",
  });
  pool.on("connect", async client => {
    log
      .atInfo()
      .log(
        `Connecting new client ${connectionUrl}. Pool stat: idle=${pool.idleCount}, waiting=${pool.waitingCount}, total=${pool.totalCount}` +
          (schema ? `. Default schema: ${schema}` : "")
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
