import { requireDefined, getClickhouseConfig, ClickhouseEnvVars } from "juava";
import { createPg, getPostgresStore } from "./store";
import { createClient } from "@clickhouse/client";
import { S3Client } from "@aws-sdk/client-s3";

const dbUrl = requireDefined(process.env.DATABASE_URL, "DATABASE_URL");

export const pg = createPg(dbUrl, { connectionName: "kvstore" });

export const store = getPostgresStore(pg, { tableName: "newjitsuee.kvstore" });

export const telemetryDb = createPg(process.env.TELEMETRY_DATABASE_URL || dbUrl, { connectionName: "telemetry" });

const chConfig = getClickhouseConfig(process.env as ClickhouseEnvVars);

export const clickhouse = createClient({
  url: chConfig.url,
  database: chConfig.database,
  username: chConfig.username,
  password: chConfig.password,
  request_timeout: 600_000,
});

export const s3client = new S3Client({
  region: requireDefined(process.env.S3_REGION, `env S3_REGION is not defined`),
  credentials: {
    accessKeyId: requireDefined(process.env.S3_ACCESS_KEY_ID, `env S3_ACCESS_KEY_ID is not defined`),
    secretAccessKey: requireDefined(process.env.S3_SECRET_ACCESS_KEY, `env S3_SECRET_ACCESS_KEY is not defined`),
  },
  endpoint: process.env.S3_ENDPOINT || undefined,
});
