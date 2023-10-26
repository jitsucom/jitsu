-- not managed by prisma
create table newjitsu_metrics.active_incoming on cluster jitsu_cluster
(
    timestamp DateTime,
    workspaceId LowCardinality(String),
    messageId String
)
    engine = Null;


CREATE MATERIALIZED VIEW newjitsu_metrics.mv_active_incoming on cluster jitsu_cluster
            (
                `timestamp` DateTime,
                `workspaceId` LowCardinality(String),
                `count` AggregateFunction(uniq, String)
                )
            ENGINE = ReplicatedAggregatingMergeTree('/clickhouse/tables/{shard}/newjitsu_metrics/mv_active_incoming5',
            '{replica}')
            ORDER BY (timestamp, workspaceId)
            SETTINGS index_granularity = 8192
AS
SELECT
    timestamp,
    workspaceId,
    uniqState(messageId) AS count
FROM newjitsu_metrics.active_incoming
GROUP BY
    timestamp,
    workspaceId;


CREATE TABLE newjitsu_metrics.metrics on cluster jitsu_cluster
(
    timestamp DateTime,
    messageId String,
    workspaceId LowCardinality(String),
    streamId LowCardinality(String),
    connectionId LowCardinality(String),
    functionId LowCardinality(String),
    destinationId LowCardinality(String),
    status LowCardinality(String),
    events Int64
    )
    ENGINE = Null;

CREATE MATERIALIZED VIEW newjitsu_metrics.mv_metrics on cluster jitsu_cluster
        (
        timestamp DateTime,
        workspaceId LowCardinality(String),
        streamId LowCardinality(String),
        connectionId LowCardinality(String),
        functionId LowCardinality(String),
        destinationId LowCardinality(String),
        status LowCardinality(String),
        events AggregateFunction(sum, Int64),
        uniqEvents AggregateFunction(uniq, String)

        )
        ENGINE = ReplicatedAggregatingMergeTree('/clickhouse/tables/{shard}/newjitsu_metrics/mv_metrics', '{replica}') ORDER BY (timestamp, workspaceId, streamId, connectionId, functionId, destinationId, status)
AS SELECT
       timestamp,
       workspaceId,
       streamId,
       connectionId,
       functionId,
       destinationId,
       status,
       sumState(events) AS events,
       uniqState(messageId) AS uniqEvents
   FROM newjitsu_metrics.metrics
   GROUP BY timestamp, workspaceId, streamId, connectionId, functionId, destinationId, status;