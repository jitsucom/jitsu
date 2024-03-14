import { createRoute, verifyAdmin } from "../../../lib/api";
import { getLog } from "juava";
import { clickhouse } from "../../../lib/server/clickhouse";

export const log = getLog("events-log-trim");

export default createRoute()
  .GET({
    auth: true,
  })
  .handler(async ({ res, user }) => {
    await verifyAdmin(user);
    log.atInfo().log(`Init events log`);
    const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || "newjitsu_metrics";
    const createTableQuery: string = `create table IF NOT EXISTS ${metricsSchema}.events_log
--ON CLUSTER jitsu_cluster
                                 (
                                   timestamp DateTime64(3),
                                   actorId LowCardinality(String),
                                   type LowCardinality(String),
                                   level LowCardinality(String),
                                   message   String
                                 )
      engine = MergeTree()
    --engine = ReplicatedMergeTree('/clickhouse/tables/{shard}/newjitsu_metrics/events_log3', '{replica}')
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (actorId, type, timestamp)`;

    try {
      await clickhouse.command({
        query: createTableQuery,
      });
      log.atInfo().log(`Table ${metricsSchema}.events_log created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.events_log table.`);
    }
  })
  .toNextApiHandler();
