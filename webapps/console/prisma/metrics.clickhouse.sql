-- ClickHouse DDL for the metrics pipeline: the per-minute event `metrics`
-- aggregation (metrics -> to_mv_metrics -> mv_metrics) and the active-users
-- pipeline (active_incoming -> mv_active_incoming2/3 -> active_incoming_agg ->
-- active_incoming_agg_view, refreshed by mv_active_incoming_agg).
--
-- NOT managed by prisma, and NOT plain SQL you paste into a client: this is a
-- template rendered and executed by lib/server/clickhouse-init.ts
-- (initMetricsTables) — in prod against the metrics cluster, in tests against a
-- single-node container. Placeholders:
--   ${db}                    target database (e.g. newjitsu_metrics)
--   ${onCluster}             " ON CLUSTER `<cluster>`" on a cluster, empty single-node
--   ${engine:Family:znode}   Replicated<Family>('/clickhouse/tables/{shard}/<db>/<znode>', '{replica}')
--                            on a cluster, plain <Family>() single-node
-- A directive line "-- @ch-settings k=v" applies those ClickHouse settings to
-- the NEXT statement only. Statements are separated by ';' and run top to
-- bottom, so objects are ordered dependencies-first.

-- ── active-users pipeline ───────────────────────────────────────────────────

-- Ingest entry point: rotor writes active-user pings here; the Null engine
-- keeps nothing and only fans out to the materialized views below.
create table ${db}.active_incoming${onCluster}
(
    timestamp DateTime,
    workspaceId LowCardinality(String),
    messageId String
)
engine = Null;

CREATE MATERIALIZED VIEW ${db}.mv_active_incoming2${onCluster}
(
    `workspaceId` LowCardinality(String),
    `timestamp` DateTime,
    `count` AggregateFunction(uniq, String)
)
ENGINE = ${engine:AggregatingMergeTree:mv_active_incoming2_0}
ORDER BY (workspaceId, timestamp)
PARTITION BY toYYYYMM(timestamp)
SETTINGS index_granularity = 8192
AS
SELECT
    workspaceId,
    timestamp,
    uniqState(messageId) AS count
FROM ${db}.active_incoming
GROUP BY
    workspaceId,
    timestamp;

CREATE TABLE ${db}.active_incoming_agg${onCluster}
(
    `workspaceId` LowCardinality(String),
    `timestamp` DateTime,
    `insertedAt` DateTime DEFAULT now(),
    `count` UInt64
)
ENGINE = ReplacingMergeTree()
ORDER BY (workspaceId, timestamp)
PARTITION BY toYYYYMM(timestamp);

-- REFRESH ... APPEND materialized views are still experimental in 25.4.
-- @ch-settings allow_experimental_refreshable_materialized_view=1
CREATE MATERIALIZED VIEW ${db}.mv_active_incoming_agg${onCluster}
REFRESH EVERY 5 MINUTE APPEND TO ${db}.active_incoming_agg AS
select
    workspaceId,
    timestamp,
    now() as insertedAt,
    uniqMerge(count) as "count"
from ${db}.mv_active_incoming2
where
    timestamp >= date_trunc('day', now() - interval 3 day)
group by workspaceId, timestamp order by workspaceId, timestamp;

CREATE VIEW ${db}.active_incoming_agg_view${onCluster} AS
select
    timestamp,
    workspaceId,
    count
from ${db}.active_incoming_agg
ORDER BY workspaceId, timestamp DESC, insertedAt DESC
LIMIT 1 BY workspaceId, timestamp;

-- ── per-minute event metrics ────────────────────────────────────────────────

-- Ingest entry point for per-event metrics; Null engine fans out to to_mv_metrics.
CREATE TABLE IF NOT EXISTS ${db}.metrics${onCluster}
(
    timestamp DateTime,
    messageId String,
    workspaceId LowCardinality(String),
    streamId LowCardinality(String),
    connectionId LowCardinality(String),
    functionId LowCardinality(String),
    destinationId LowCardinality(String),
    status LowCardinality(String),
    events Int64,
    eventIndex UInt32
)
ENGINE = Null;

create table ${db}.mv_metrics${onCluster}
(
    timestamp DateTime,
    workspaceId LowCardinality(String),
    streamId LowCardinality(String),
    connectionId LowCardinality(String),
    functionId LowCardinality(String),
    destinationId LowCardinality(String),
    status LowCardinality(String),
    events AggregateFunction(sum, Int64)
)
engine = ${engine:AggregatingMergeTree:mv_metrics}
ORDER BY (timestamp, workspaceId, streamId, connectionId, functionId, destinationId, status)
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW ${db}.to_mv_metrics${onCluster}
TO ${db}.mv_metrics
(
    `timestamp` DateTime,
    `workspaceId` LowCardinality(String),
    `streamId` LowCardinality(String),
    `connectionId` LowCardinality(String),
    `functionId` LowCardinality(String),
    `destinationId` LowCardinality(String),
    `status` LowCardinality(String),
    `events` AggregateFunction(sum, Int64)
)
AS
SELECT
    date_trunc('minute', timestamp) as timestamp,
    workspaceId,
    streamId,
    connectionId,
    functionId,
    destinationId,
    status,
    sumState(events) AS events
FROM ${db}.metrics
GROUP BY
    timestamp,
    workspaceId,
    streamId,
    connectionId,
    functionId,
    destinationId,
    status;
