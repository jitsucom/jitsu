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

-- Retention: keep the newest EVENTS_LOG_SIZE (default 200000) rows per
-- (actorId, type, is_error). A cutoff dictionary holds, per entity, the
-- timestamp of the N-th newest row; the TTL below deletes anything older on
-- merge. Unlike the old lightweight-delete trim, TTL DELETE physically
-- reclaims disk. Created/maintained by pages/api/admin/events-log-init.ts and
-- enforced by pages/api/admin/events-log-trim.ts (drop floor + reload dict +
-- MATERIALIZE TTL). dictGet in a TTL requires allow_suspicious_ttl_expressions=1.

-- Cutoffs live in their own table (NOT computed by the dictionary directly
-- from events_log): a dictionary sourcing from events_log while events_log's
-- TTL references that dictionary is a cyclic dependency that ClickHouse
-- rejects. events-log-trim.ts recomputes this table each run:
--   truncate table newjitsu_metrics.events_log_cutoff_src;
--   insert into newjitsu_metrics.events_log_cutoff_src
--     select actorId, type, toUInt8(level = 'error') as is_error,
--            arrayElement(arrayReverseSort(groupArray(timestamp)), 200000) as cutoff
--     from newjitsu_metrics.events_log group by actorId, type, is_error
--     having count() > 200000;
create table IF NOT EXISTS newjitsu_metrics.events_log_cutoff_src
--ON CLUSTER jitsu_cluster
(
    actorId String,
    type String,
    is_error UInt8,
    cutoff DateTime64(3)
)
    engine = MergeTree()
    --engine = ReplicatedMergeTree('/clickhouse/tables/{shard}/newjitsu_metrics/events_log_cutoff_src', '{replica}')
        ORDER BY (actorId, type, is_error);

create dictionary IF NOT EXISTS newjitsu_metrics.events_log_cutoff
--ON CLUSTER jitsu_cluster
(
    actorId String,
    type String,
    is_error UInt8,
    cutoff DateTime64(3)
)
PRIMARY KEY actorId, type, is_error
SOURCE(CLICKHOUSE(
    host 'localhost' port 9000 user 'default' password '' db 'newjitsu_metrics' table 'events_log_cutoff_src'
))
LAYOUT(COMPLEX_KEY_HASHED())
LIFETIME(MIN 1800 MAX 3600);

-- SET allow_suspicious_ttl_expressions = 1, materialize_ttl_after_modify = 0;
alter table newjitsu_metrics.events_log
--ON CLUSTER jitsu_cluster
    modify TTL toDateTime(
        if(timestamp < dictGetOrDefault('newjitsu_metrics.events_log_cutoff', 'cutoff', (actorId, type, toUInt8(level = 'error')), toDateTime64('1970-01-01 00:00:00', 3)),
           toDateTime('2000-01-01 00:00:00'),
           toDateTime('2099-01-01 00:00:00'))) DELETE;

