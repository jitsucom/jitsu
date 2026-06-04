import { createRoute, getUser, verifyAdmin } from "../../../lib/api";
import { checkRawToken, getClickhouseConfig } from "juava";
import { clickhouse } from "../../../lib/server/clickhouse";
import { z } from "zod";
import { getServerLog } from "../../../lib/server/log";
import { getServerEnv } from "../../../lib/server/serverEnv";

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
    const metricsSchema = getClickhouseConfig(serverEnv).database;
    const metricsCluster = serverEnv.CLICKHOUSE_METRICS_CLUSTER || serverEnv.CLICKHOUSE_CLUSTER;
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
    const errors: Error[] = [];
    const createEventsLogTableQuery: string = `create table IF NOT EXISTS ${metricsSchema}.events_log ${onCluster}
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
        query: createEventsLogTableQuery,
      });
      log.atInfo().log(`Table ${metricsSchema}.events_log created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.events_log table.`);
      errors.push(new Error(`Failed to create ${metricsSchema}.events_log table.`));
    }
    const createTaskLogTableQuery: string = `create table IF NOT EXISTS ${metricsSchema}.task_log ${onCluster}
         (
           task_id String,
           sync_id LowCardinality(String),
           timestamp DateTime64(3),
           level LowCardinality(String),
           logger LowCardinality(String),
           message   String
         )
         engine = ${
           metricsCluster
             ? "ReplicatedMergeTree('/clickhouse/tables/{shard}/" + metricsSchema + "/task_log', '{replica}')"
             : "MergeTree()"
         } 
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (task_id, sync_id, timestamp)
        TTL toDateTime(timestamp) + INTERVAL 3 MONTH DELETE`;

    try {
      await clickhouse.command({
        query: createTaskLogTableQuery,
      });
      log.atInfo().log(`Table ${metricsSchema}.task_log created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.task_log table.`);
      errors.push(new Error(`Failed to create ${metricsSchema}.task_log table.`));
    }
    const createDeadLetterTableQuery: string = `create table IF NOT EXISTS ${metricsSchema}.dead_letter ${onCluster}
         (
           timestamp DateTime64(3),
           workspaceId LowCardinality(String),
           actorId LowCardinality(String),
           type LowCardinality(String),
           payload String,
           error   String
         )
         engine = ${
           metricsCluster
             ? "ReplicatedMergeTree('/clickhouse/tables/{shard}/" + metricsSchema + "/dead_letter', '{replica}')"
             : "MergeTree()"
         } 
        ORDER BY (workspaceId, actorId, timestamp)
        TTL toDateTime(timestamp) + INTERVAL 1 MONTH DELETE`;

    try {
      await clickhouse.command({
        query: createDeadLetterTableQuery,
      });
      log.atInfo().log(`Table ${metricsSchema}.dead_letter or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.dead_letter table.`);
      errors.push(new Error(`Failed to create ${metricsSchema}.dead_letter table.`));
    }
    if (errors.length > 0) {
      throw new Error("Failed to initialize tables: " + errors.map(e => e.message).join(", "));
    }
  })
  .toNextApiHandler();
