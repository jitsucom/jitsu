import { NextApiRequest, NextApiResponse } from "next";
import { getLog } from "juava";
import { pg, store } from "../../../lib/services";

const healthChecks: Record<string, () => Promise<any>> = {
  postgres: async () => {
    const pgPool = await pg.waitInit();
    await pgPool.query(`SELECT 1 as pgpool_healthcheck`);
  },
  pgstore: async () => {
    const pgStore = await store.waitInit();
    await pgStore.getTable("last_healthcheck").put("last_healthcheck", {
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
