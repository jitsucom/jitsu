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

