// ClickHouse DDL for the per-file test database. Statements are lifted from:
//   - pages/api/admin/events-log-init.ts (events_log, task_log, dead_letter —
//     the non-cluster MergeTree branch; the cutoff tables / dictionary / dictGet
//     TTL are retention machinery no service under test queries, so they are
//     skipped here)
//   - prisma/metrics.sql (metrics + mv_metrics + to_mv_metrics, with ON CLUSTER
//     removed and ReplicatedAggregatingMergeTree de-replicated)
// If either source changes shape, update this file to match.
export function chDdl(db: string): string[] {
  return [
    `create table ${db}.events_log
       (
         timestamp DateTime64(3),
         actorId LowCardinality(String),
         type LowCardinality(String),
         level LowCardinality(String),
         message String
       )
       engine = MergeTree()
       PARTITION BY toYYYYMM(timestamp)
       ORDER BY (actorId, type, timestamp)`,
    `create table ${db}.task_log
       (
         task_id String,
         sync_id LowCardinality(String),
         timestamp DateTime64(3),
         level LowCardinality(String),
         logger LowCardinality(String),
         message String
       )
       engine = MergeTree()
       PARTITION BY toYYYYMM(timestamp)
       ORDER BY (task_id, sync_id, timestamp)
       TTL toDateTime(timestamp) + INTERVAL 3 MONTH DELETE`,
    `create table ${db}.dead_letter
       (
         timestamp DateTime64(3),
         workspaceId LowCardinality(String),
         actorId LowCardinality(String),
         type LowCardinality(String),
         payload String,
         error String
       )
       engine = MergeTree()
       ORDER BY (workspaceId, actorId, timestamp)
       TTL toDateTime(timestamp) + INTERVAL 1 MONTH DELETE`,
    `create table ${db}.metrics
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
       ENGINE = Null`,
    `create table ${db}.mv_metrics
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
       engine = AggregatingMergeTree()
       ORDER BY (timestamp, workspaceId, streamId, connectionId, functionId, destinationId, status)`,
    `CREATE MATERIALIZED VIEW ${db}.to_mv_metrics
       TO ${db}.mv_metrics
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
       AS SELECT
         date_trunc('minute', timestamp) as timestamp,
         workspaceId,
         streamId,
         connectionId,
         functionId,
         destinationId,
         status,
         sumState(events) AS events
       FROM ${db}.metrics
       GROUP BY timestamp, workspaceId, streamId, connectionId, functionId, destinationId, status`,
  ];
}
