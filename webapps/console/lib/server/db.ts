import { PrismaClient } from "@prisma/client";
import { Pool, PoolClient } from "pg";
import Cursor from "pg-cursor";
import { getSingleton, namedParameters, newError, requireDefined, stopwatch } from "juava";
import { getServerLog } from "./log";
import { isReadOnly } from "./read-only-mode";
import { isTruish } from "../shared/chores";

export type Handler = (row: Record<string, any>) => Promise<void> | void;

//we will need to support named params in future
export type ParamValues = any[] | Record<string, any>;
const log = getServerLog("db");

type PgHelper = {
  streamQuery(query: string, values?: ParamValues | Handler, handler?: Handler | undefined): Promise<{ rows: number }>;
};

const pgHelper: PgHelper = {
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
    let cursor: Cursor = undefined;
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
  prisma: getSingleton<PrismaClient>("prisma", createPrisma),
  pgPool: getSingleton<Pool>("pg", createPg),
  pgHelper: () => pgHelper,
} as const;

export type DatabaseConnection = typeof db;

export type PrismaSSLMode = "disable" | "prefer" | "require" | "no-verify";

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
  const sslMode = parsedUrl.searchParams.get("sslmode") || ("disable" as PrismaSSLMode);
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

const mutationActions = ["create", "update", "upsert", "delete"];

function blockPrismaMutations() {
  return async (params, next) => {
    const action = params.action;
    if (mutationActions.find(candidate => action.indexOf(candidate) === 0)) {
      throw new Error(`Prisma operation ${action} is not allowed in read-only mode`);
    }
    return await next(params);
  };
}

export function getApplicationDatabaseUrl(): string {
  return requireDefined(
    process.env.APP_DATABASE_URL || process.env.DATABASE_URL,
    "neither env.DATABASE_URL, nor env.APP_DATABASE_URL is not defined"
  );
}

export function isUsingPgBouncer() {
  return isTruish(new URL(getApplicationDatabaseUrl()).searchParams.get("pgbouncer"));
}

export function createPrisma(): PrismaClient {
  // @ts-ignore
  if (typeof window !== "undefined") {
    log
      .atWarn()
      .log(
        "Prisma initialization is called from browser. Unless the code makes an actual call to prisma, nothing will happen. See stacktrace for more info.",
        new Error().stack
      );
    return new Proxy(
      {},
      {
        get: (target, name) => {
          throw new Error(`PrismaClient not available in browser (attempted to access ${name.toString()})`);
        },
      }
    ) as PrismaClient;
  }
  log.atInfo().log("Initializing prisma");
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: getApplicationDatabaseUrl(),
      },
    },
    log: [
      {
        emit: "event",
        level: "query",
      },
      {
        emit: "stdout",
        level: "error",
      },
      {
        emit: "stdout",
        level: "info",
      },
      {
        emit: "stdout",
        level: "warn",
      },
    ],
  });
  let queryCounter = 0;

  // prisma.$use(async (params, next) => {
  //   const before = Date.now()
  //
  //   const actionDescription = `${params.model ? params.model + "." : ""}${params.action}`
  //   getLog().debug(`>>>>>>>> START prisma action ${actionDescription} `)
  //
  //   const result = await next(params)
  //
  //   const after = Date.now()
  //
  //   getLog().debug(
  //     `<<<<<<<<< END prisma action ${actionDescription} ${params.dataPath} took ${after - before}ms. Result size: ${
  //       Array.isArray(result) ? result.length : 1
  //     }`
  //   )
  //
  //   return result
  // })
  prisma.$on("query", e => {
    if (isTruish(process.env.CONSOLE_DATABASE_DEBUG)) {
      log
        .atDebug()
        .log(
          `SQL executed ${queryCounter++}. Duration: ${e.duration}ms: ${e.query.replaceAll("\n", " ").trim()}${
            e.params !== "[]" ? " " + e.params : ""
          }`
        );
    }
  });
  if (isReadOnly) {
    prisma.$use(blockPrismaMutations());
  }

  return prisma;
}
