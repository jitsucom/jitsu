import { getErrorMessage, getSingleton, requireDefined } from "juava";
import { createPg, getPostgresStore } from "./store";
import { createClient } from "@clickhouse/client";
import { S3Client } from "@aws-sdk/client-s3";

import PG from "pg";
import { getServerLog } from "./log";

const dbUrl = requireDefined(
  process.env.EE_DATABASE_URL || process.env.DATABASE_URL,
  "nor EE_DATABASE_URL, neither DATABASE_URL is not defined"
);

export const pg = getSingleton("postgres", () => createPg(dbUrl, { connectionName: "kvstore" }));

export const store = getSingleton("pgstore", async () => {
  getServerLog().atInfo().log("Initializing postgres store (pgstore) - initializing postgres pool");
  let pgPool: PG.Pool;
  try {
    pgPool = await pg.waitInit();
  } catch (e) {
    const msg = `Failed to initialize postgres pool: ${getErrorMessage(e)}`;
    throw new Error(msg);
  }
  getServerLog().atInfo().log("Postgres connection pool initialized - initializing kvstore");
  try {
    return getPostgresStore(pgPool, { tableName: "kvstore" });
  } catch (e) {
    const msg = `Failed to initialize kv store: ${getErrorMessage(e)}`;
    throw new Error(msg);
  }
});

export const telemetryDb = getSingleton("telemetry_db", () =>
  createPg(process.env.TELEMETRY_DATABASE_URL || dbUrl, { connectionName: "telemetry" })
);

export const clickhouse = getSingleton("clickhouse", () => {
  return createClient({
    host: requireDefined(process.env.CLICKHOUSE_URL, `env CLICKHOUSE_URL is not defined`),
    username: process.env.CLICKHOUSE_USERNAME || "default",
    password: requireDefined(process.env.CLICKHOUSE_PASSWORD, `env CLICKHOUSE_PASSWORD is not defined`),
  });
});

export const s3client = getSingleton("s3client", () => {
  return new S3Client({
    region: requireDefined(process.env.S3_REGION, `env S3_REGION is not defined`),
    credentials: {
      accessKeyId: requireDefined(process.env.S3_ACCESS_KEY_ID, `env S3_ACCESS_KEY_ID is not defined`),
      secretAccessKey: requireDefined(process.env.S3_SECRET_ACCESS_KEY, `env S3_SECRET_ACCESS_KEY is not defined`),
    },
    endpoint: process.env.S3_ENDPOINT || undefined,
  });
});
