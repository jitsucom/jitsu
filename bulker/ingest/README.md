# Ingest Kafka producers

Ingest uses three independent Kafka producer queues:

| Producer | Traffic | Message limit | Payload limit (KiB) |
| --- | --- | --- | --- |
| `pipeline` | Functions pipeline, including shards | `INGEST_PRODUCER_QUEUE_SIZE` (100,000) | `INGEST_PRODUCER_QUEUE_SIZE_KB` (1,048,576) |
| `backup` | Workspace backup topics | `INGEST_BACKUP_PRODUCER_QUEUE_SIZE` (100,000) | `INGEST_BACKUP_PRODUCER_QUEUE_SIZE_KB` (262,144) |
| `telemetry` | Live Events exports, billing/connection metrics, dead letters | `INGEST_TELEMETRY_PRODUCER_QUEUE_SIZE` (10,000) | `INGEST_TELEMETRY_PRODUCER_QUEUE_SIZE_KB` (32,768) |

Defaults are shown in parentheses. Each queue is constrained by both limits;
Kafka payload-byte limits do not include all native-client or Go memory overhead.
Budget pod memory for all three clients. Existing batch size, linger, compression,
and delivery timeout settings apply to each producer.

A full background queue cannot consume pipeline queue capacity. Backup and
telemetry sends retain their existing best-effort behavior; this change does not
add durable backup overflow recovery. Only the pipeline producer owns the existing
failover logger, whose files remain compatible with the reprocessing worker.

All `bulkerapp_producer_*` metrics have a `producer` label (`pipeline`, `backup`,
`telemetry`; empty for callers of the existing unnamed producer API). Existing
metric names remain unchanged. Group dashboard series by `(pod_name, producer)`;
filter `producer="pipeline"` when alerting on primary ingestion queue capacity.
Producers flush concurrently during shutdown, before their clients are closed.
