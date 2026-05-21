import { requireDefined, getClickhouseConfig, ClickhouseEnvVars } from "juava";
import { createPg, getKvStore } from "./store";
import { createClient } from "@clickhouse/client";
import { S3Client } from "@aws-sdk/client-s3";

// Prisma client for the `newjitsuee` schema (ee-api's own tables).
export { prisma, Prisma } from "./db";

const dbUrl = requireDefined(process.env.DATABASE_URL, "DATABASE_URL");

// Raw `pg` pool for the `newjitsu` schema, which is owned by webapps/console's
// Prisma. Tables in the `newjitsuee` schema are handled by `prisma` above.
export const pg = createPg(dbUrl, { connectionName: "newjitsu" });

export const store = getKvStore();

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
