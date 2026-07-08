import type { ClickHouseClient } from "@clickhouse/client";
import { getServerLog } from "./log";

const log = getServerLog("events-log-init");

export interface EventsLogInitOptions {
  clickhouse: ClickHouseClient;
  /** Target database (aka metrics schema), e.g. `newjitsu_metrics`. */
  database: string;
  /** ClickHouse cluster name — omitted on single-node installations (and in tests). */
  cluster?: string | undefined;
  /** Credentials embedded into the cutoff dictionary's SOURCE clause. */
  username: string;
  password: string;
}

/**
 * Create the events-log ClickHouse objects: the database, the `events_log` /
 * `task_log` / `dead_letter` tables, and the events_log retention machinery
 * (cutoff tables + dictionary + dictGet-driven TTL). Used by the
 * `admin/events-log-init` route against the prod cluster and by the test
 * harness against a per-test-file database — one source for the DDL.
 *
 * Throws when the database can't be created; accumulates per-object failures
 * and throws a combined error at the end otherwise.
 */
export async function initEventsLogTables(opts: EventsLogInitOptions): Promise<void> {
  const { clickhouse, database: metricsSchema } = opts;
  // Backtick-quote the cluster name: the k8s metrics cluster is `jitsu-cluster`
  // (the Altinity CRD forbids underscores), and an unquoted hyphen breaks the
  // ON CLUSTER DDL ("syntax error at -cluster").
  const onCluster = opts.cluster ? ` ON CLUSTER \`${opts.cluster}\`` : "";
  const mergeTree = (name: string) =>
    opts.cluster
      ? `ReplicatedMergeTree('/clickhouse/tables/{shard}/${metricsSchema}/${name}', '{replica}')`
      : "MergeTree()";

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
       engine = ${mergeTree("events_log")}
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
       engine = ${mergeTree("task_log")}
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
       engine = ${mergeTree("dead_letter")}
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

  // The cutoffs live in their own small table rather than being computed by
  // the dictionary directly from events_log: a dictionary that sourced from
  // events_log while events_log's TTL references that dictionary would be a
  // cyclic dependency (ClickHouse rejects it). events-log-trim recomputes the
  // contents of this table (one row per over-cap entity).
  // The `_staging` twin lets the trim job rebuild cutoffs and swap them in
  // atomically (EXCHANGE TABLES), so a transient recompute failure never
  // leaves the live table empty (which would pause retention).
  const cutoffTable = (name: string): string => `create table IF NOT EXISTS ${metricsSchema}.${name} ${onCluster}
       (
         actorId String,
         type String,
         is_error UInt8,
         cutoff DateTime64(3)
       )
       engine = ${mergeTree(name)}
      ORDER BY (actorId, type, is_error)`;
  for (const name of ["events_log_cutoff_src", "events_log_cutoff_staging"]) {
    try {
      await clickhouse.command({ query: cutoffTable(name) });
      log.atInfo().log(`Table ${metricsSchema}.${name} created or already exists`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to create ${metricsSchema}.${name} table.`);
      errors.push(new Error(`Failed to create ${metricsSchema}.${name} table.`));
    }
  }

  // Credentials are interpolated into the DDL, so escape single quotes (the
  // values come from trusted config, not user input). Note the rendered DDL
  // — including these creds — is visible in ClickHouse query logs and
  // SHOW CREATE; a named collection is the follow-up to remove that exposure.
  const sqlLit = (s: string): string => s.replace(/'/g, "''");
  const chUser = sqlLit(opts.username);
  const chPass = sqlLit(opts.password);
  const createCutoffDictQuery: string = `create dictionary IF NOT EXISTS ${metricsSchema}.events_log_cutoff ${onCluster}
       (
         actorId String,
         type String,
         is_error UInt8,
         cutoff DateTime64(3)
       )
       PRIMARY KEY actorId, type, is_error
       SOURCE(CLICKHOUSE(
         user '${chUser}' password '${chPass}' db '${metricsSchema}' table 'events_log_cutoff_src'
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
}
