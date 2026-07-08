import { createRoute, getUser, verifyAdmin } from "../../../lib/api";
import { checkRawToken, getClickhouseConfig, requireDefined } from "juava";
import { clickhouse } from "../../../lib/server/clickhouse";
import { z } from "zod";
import { getServerLog } from "../../../lib/server/log";
import { getServerEnv } from "../../../lib/server/serverEnv";
import { initEventsLogTables } from "../../../lib/server/clickhouse-init";

const log = getServerLog("events-log-init");

export default createRoute()
  .GET({
    // GET but creates ClickHouse tables. The maintenance gate blocks it;
    // operator re-runs after maintenance ends.
    mutates: true,
    query: z.object({
      token: z.string().optional(),
    }),
  })
  .handler(async ({ req, res, query }) => {
    const serverEnv = getServerEnv();
    let initTokenUsed = false;
    if (serverEnv.CONSOLE_INIT_TOKEN && query.token) {
      if (checkRawToken(serverEnv.CONSOLE_INIT_TOKEN, query.token)) {
        initTokenUsed = true;
      }
    }
    if (!initTokenUsed) {
      const user = await getUser(res, req);
      if (!user) {
        res.status(401).send({ error: "Authorization Required" });
        return;
      }
      await verifyAdmin(user);
    }
    log.atInfo().log(`Init events log`);
    const chConfig = getClickhouseConfig(serverEnv);
    await initEventsLogTables({
      clickhouse,
      database: requireDefined(chConfig.database, "ClickHouse database is not configured"),
      cluster: serverEnv.CLICKHOUSE_METRICS_CLUSTER || serverEnv.CLICKHOUSE_CLUSTER,
      username: chConfig.username,
      password: chConfig.password,
    });
  })
  .toNextApiHandler();
