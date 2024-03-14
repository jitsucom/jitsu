-- not managed by prisma
create table IF NOT EXISTS newjitsu_metrics.events_log
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
        ORDER BY (actorId, type, timestamp)
        SETTINGS index_granularity = 8192;

