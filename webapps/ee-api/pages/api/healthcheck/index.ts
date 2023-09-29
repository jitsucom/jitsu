import { NextApiRequest, NextApiResponse } from "next";
import { getLog } from "juava";
import { clickhouse, pg, s3client, store, telemetryDb } from "../../../lib/services";
import { ListBucketsCommand } from "@aws-sdk/client-s3";

const healthChecks: Record<string, () => Promise<any>> = {
  postgres: async () => {
    await pg.query(`SELECT 1 as pgpool_healthcheck`);
  },
  clickhouse: async () => {
    await clickhouse.query({ query: `SELECT 1 as chpool_healthcheck`, clickhouse_settings: { wait_end_of_query: 1 } });
  },
  telemetryDb: async () => {
    await telemetryDb.query(`SELECT 1 as telemetry_healthcheck`);
  },
  s3: async () => {
    await s3client.send(new ListBucketsCommand({}));
  },
  pgstore: async () => {
    await store.getTable("last_healthcheck").put("last_healthcheck", {
      timestamp: new Date().toISOString(),
      env: process.env,
    });
  },
};

const log = getLog("healthcheck");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const result: Record<string, any> = {};
  let hasErrors: boolean = false;
  for (const [service, check] of Object.entries(healthChecks)) {
    try {
      const start = Date.now();
      await check();
      const ms = Date.now() - start;
      result[service] = { status: "ok", ms };
    } catch (e) {
      log.atError().withCause(e).log(`Service ${service} failed to initialize`, e);
      result[service] = { status: "error" };
      hasErrors = true;
    }
  }
  res.status(hasErrors ? 500 : 200).send({ status: hasErrors ? "error" : "ok", ...result });
}
