import { getLog } from "juava";

export const log = getLog("events-log-init");

export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    log.atInfo().log(`Init events log. Skipping runtime ${process.env.NEXT_RUNTIME}`);
    return;
  }
  log.atInfo().log(`Init events log`);
  const ch = await import("./lib/server/clickhouse");
  const clickhouse = ch.clickhouse;
  const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || "newjitsu_metrics";
  const createDbQuery: string = `create database IF NOT EXISTS ${metricsSchema}
--ON CLUSTER jitsu_cluster`;
  try {
    await clickhouse.command({
      query: createDbQuery,
    });
    log.atInfo().log(`Database ${metricsSchema} created or already exists`);

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

    await clickhouse.command({
      query: createTableQuery,
    });
    log.atInfo().log(`Table ${metricsSchema}.events_log created or already exists`);
  } catch (e: any) {
    log.atError().withCause(e).log(`Failed to create ${metricsSchema}.events_log table.`);
  }
}
