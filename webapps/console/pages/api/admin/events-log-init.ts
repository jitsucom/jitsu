import { createRoute, getUser, verifyAdmin } from "../../../lib/api";
import { checkRawToken, getLog } from "juava";
import { clickhouse } from "../../../lib/server/clickhouse";
import { z } from "zod";

export const log = getLog("events-log-trim");

export default createRoute()
  .GET({
    query: z.object({
      token: z.string().optional(),
    }),
  })
  .handler(async ({ req, res, query, user }) => {
    let initTokenUsed = false;
    if (process.env.CONSOLE_INIT_TOKEN && query.token) {
      if (checkRawToken(process.env.CONSOLE_INIT_TOKEN, query.token)) {
        process.env.CONSOLE_INIT_TOKEN = undefined;
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
    const metricsSchema =
      process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";
    const metricsCluster = process.env.CLICKHOUSE_METRICS_CLUSTER;
    const onCluster = metricsCluster ? ` ON CLUSTER ${metricsCluster}` : "";
    const createDbQuery: string = `create database IF NOT EXISTS ${metricsSchema}${onCluster}`;
    try {
      await clickhouse.command({
        query: createDbQuery,
      });
      log.atInfo().log(`Database ${metricsSchema} created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema} database.`);
      throw new Error(`Failed to create ${metricsSchema} database.`);
    }
    const createTableQuery: string = `create table IF NOT EXISTS ${metricsSchema}.events_log ${onCluster}
         (
           timestamp DateTime64(3),
           actorId LowCardinality(String),
           type LowCardinality(String),
           level LowCardinality(String),
           message   String
         )
         engine = ${
           metricsCluster
             ? "ReplicatedMergeTree('/clickhouse/tables/{shard}/" + metricsSchema + "/events_log', '{replica}')"
             : "MergeTree()"
         } 
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (actorId, type, timestamp)`;

    try {
      await clickhouse.command({
        query: createTableQuery,
      });
      log.atInfo().log(`Table ${metricsSchema}.events_log created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.events_log table.`);
      throw new Error(`Failed to create ${metricsSchema}.events_log table.`);
    }
  })
  .toNextApiHandler();
