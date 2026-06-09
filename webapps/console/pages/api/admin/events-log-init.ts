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
    const chConfig = getClickhouseConfig(serverEnv);
    const metricsSchema = chConfig.database;
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
    // --- events_log retention: cutoff dictionary + dictGet-driven TTL ---
    // Goal: keep the newest EVENTS_LOG_SIZE rows per (actorId, type, is_error).
    // The dictionary holds, per entity, the timestamp of the N-th newest row
    // (its retention cutoff); events_log's TTL deletes anything older on merge.
    // This replaces the old full-table scan + lightweight-delete trim and,
    // unlike lightweight deletes, TTL DELETE physically reclaims disk on merge.
    // The dictionary reads the cutoff table from the local server over the
    // native protocol (default 9000): on a cluster every replica has its own
    // copy of the replicated source table, so 'localhost' avoids a single-host
    // dependency. Override the port with CLICKHOUSE_METRICS_NATIVE_PORT if needed.
    const chNativePort = serverEnv.CLICKHOUSE_METRICS_NATIVE_PORT;

    // The cutoffs live in their own small table rather than being computed by
    // the dictionary directly from events_log: a dictionary that sourced from
    // events_log while events_log's TTL references that dictionary would be a
    // cyclic dependency (ClickHouse rejects it). events-log-trim recomputes the
    // contents of this table (one row per over-cap entity).
    const createCutoffSrcQuery: string = `create table IF NOT EXISTS ${metricsSchema}.events_log_cutoff_src ${onCluster}
         (
           actorId String,
           type String,
           is_error UInt8,
           cutoff DateTime64(3)
         )
         engine = ${
           metricsCluster
             ? "ReplicatedMergeTree('/clickhouse/tables/{shard}/" +
               metricsSchema +
               "/events_log_cutoff_src', '{replica}')"
             : "MergeTree()"
         }
        ORDER BY (actorId, type, is_error)`;
    try {
      await clickhouse.command({ query: createCutoffSrcQuery });
      log.atInfo().log(`Table ${metricsSchema}.events_log_cutoff_src created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.events_log_cutoff_src table.`);
      errors.push(new Error(`Failed to create ${metricsSchema}.events_log_cutoff_src table.`));
    }

    const createCutoffDictQuery: string = `create dictionary IF NOT EXISTS ${metricsSchema}.events_log_cutoff ${onCluster}
         (
           actorId String,
           type String,
           is_error UInt8,
           cutoff DateTime64(3)
         )
         PRIMARY KEY actorId, type, is_error
         SOURCE(CLICKHOUSE(
           host 'localhost' port ${chNativePort} user '${chConfig.username}' password '${chConfig.password}' db '${metricsSchema}' table 'events_log_cutoff_src'
         ))
         LAYOUT(COMPLEX_KEY_HASHED())
         LIFETIME(MIN 1800 MAX 3600)`;
    try {
      await clickhouse.command({ query: createCutoffDictQuery });
      log.atInfo().log(`Dictionary ${metricsSchema}.events_log_cutoff created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.events_log_cutoff dictionary.`);
      errors.push(new Error(`Failed to create ${metricsSchema}.events_log_cutoff dictionary.`));
    }

    // Attach the retention TTL. allow_suspicious_ttl_expressions is required
    // because dictGet is non-deterministic; materialize_ttl_after_modify=0
    // avoids an immediate full-table mutation on deploy — enforcement happens
    // on background merges and via the events-log-trim cron's MATERIALIZE TTL.
    const modifyTtlQuery: string = `alter table ${metricsSchema}.events_log ${onCluster} modify TTL toDateTime(
           if(timestamp < dictGetOrDefault('${metricsSchema}.events_log_cutoff', 'cutoff', (actorId, type, toUInt8(level = 'error')), toDateTime64('1970-01-01 00:00:00', 3)),
              toDateTime('2000-01-01 00:00:00'),
              toDateTime('2099-01-01 00:00:00'))) DELETE`;
    try {
      await clickhouse.command({
        query: modifyTtlQuery,
        clickhouse_settings: {
          allow_suspicious_ttl_expressions: 1,
          materialize_ttl_after_modify: 0,
        },
      });
      log.atInfo().log(`Retention TTL set on ${metricsSchema}.events_log`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to set retention TTL on ${metricsSchema}.events_log.`);
      errors.push(new Error(`Failed to set retention TTL on ${metricsSchema}.events_log.`));
    }

    if (errors.length > 0) {
      throw new Error("Failed to initialize tables: " + errors.map(e => e.message).join(", "));
    }
  })
  .toNextApiHandler();
