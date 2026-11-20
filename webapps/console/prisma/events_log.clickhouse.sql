-- ClickHouse DDL for the events-log / task-log / dead-letter tables and the
-- events_log retention machinery (cutoff tables + dictionary + dictGet TTL).
--
-- NOT managed by prisma, and NOT plain SQL you paste into a client: this is a
-- template rendered and executed by lib/server/clickhouse-init.ts
-- (initEventsLogTables) — in prod against the metrics cluster, in tests
-- against a single-node container. Placeholders:
--   ${db}                    target database (e.g. newjitsu_metrics)
--   ${onCluster}             " ON CLUSTER `<cluster>`" on a cluster, empty single-node
--   ${engine:Family:znode}   Replicated<Family>('/clickhouse/tables/{shard}/<db>/<znode>', '{replica}')
--                            on a cluster, plain <Family>() single-node
--   ${user} / ${password}    dictionary source credentials (single-quote escaped)
-- A directive line of the form "-- @ch-settings k=v, k2=v2" applies those
-- ClickHouse settings to the NEXT statement only. Statements are separated by
-- ';' — keep ';' out of a statement body (only at its end).

create table IF NOT EXISTS ${db}.events_log${onCluster}
(
    timestamp DateTime64(3),
    actorId LowCardinality(String),
    type LowCardinality(String),
    level LowCardinality(String),
    message String
)
engine = ${engine:MergeTree:events_log}
PARTITION BY toYYYYMM(timestamp)
ORDER BY (actorId, type, timestamp);

create table IF NOT EXISTS ${db}.task_log${onCluster}
(
    task_id String,
    sync_id LowCardinality(String),
    timestamp DateTime64(3),
    level LowCardinality(String),
    logger LowCardinality(String),
    message String
)
engine = ${engine:MergeTree:task_log}
PARTITION BY toYYYYMM(timestamp)
ORDER BY (task_id, sync_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 3 MONTH DELETE;

create table IF NOT EXISTS ${db}.dead_letter${onCluster}
(
    timestamp DateTime64(3),
    workspaceId LowCardinality(String),
    actorId LowCardinality(String),
    type LowCardinality(String),
    payload String,
    error String
)
engine = ${engine:MergeTree:dead_letter}
ORDER BY (workspaceId, actorId, timestamp)
TTL toDateTime(timestamp) + INTERVAL 1 MONTH DELETE;

-- events_log retention: cutoff dictionary + dictGet-driven TTL. The cutoffs
-- live in their own table (not sourced directly from events_log — that would
-- be a cyclic dependency ClickHouse rejects). events-log-trim rebuilds cutoffs
-- in the _staging twin and swaps them in atomically (EXCHANGE TABLES).
create table IF NOT EXISTS ${db}.events_log_cutoff_src${onCluster}
(
    actorId String,
    type String,
    is_error UInt8,
    cutoff DateTime64(3)
)
engine = ${engine:MergeTree:events_log_cutoff_src}
ORDER BY (actorId, type, is_error);

create table IF NOT EXISTS ${db}.events_log_cutoff_staging${onCluster}
(
    actorId String,
    type String,
    is_error UInt8,
    cutoff DateTime64(3)
)
engine = ${engine:MergeTree:events_log_cutoff_staging}
ORDER BY (actorId, type, is_error);

create dictionary IF NOT EXISTS ${db}.events_log_cutoff${onCluster}
(
    actorId String,
    type String,
    is_error UInt8,
    cutoff DateTime64(3)
)
PRIMARY KEY actorId, type, is_error
SOURCE(CLICKHOUSE(
    user '${user}' password '${password}' db '${db}' table 'events_log_cutoff_src'
))
LAYOUT(COMPLEX_KEY_HASHED())
LIFETIME(MIN 1800 MAX 3600);

-- dictGet in a TTL is non-deterministic (allow_suspicious_ttl_expressions);
-- materialize_ttl_after_modify=0 avoids an immediate full-table mutation on
-- deploy — enforcement happens on background merges and via events-log-trim.
-- @ch-settings allow_suspicious_ttl_expressions=1, materialize_ttl_after_modify=0
alter table ${db}.events_log${onCluster}
modify TTL toDateTime(
    if(timestamp < dictGetOrDefault('${db}.events_log_cutoff', 'cutoff', (actorId, type, toUInt8(level = 'error')), toDateTime64('1970-01-01 00:00:00', 3)),
       toDateTime('2000-01-01 00:00:00'),
       toDateTime('2099-01-01 00:00:00'))) DELETE;
