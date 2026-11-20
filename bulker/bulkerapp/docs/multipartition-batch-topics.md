# Multi-partition batch topics

A large workspace's backup traffic can saturate a single Kafka partition even when
other brokers have spare capacity. Producer isolation protects pipeline ingestion,
but a slow backup partition can still fill each ingest pod's shared backup producer
queue and affect other workspaces' backups. More ingest replicas or longer producer
linger do not distribute a single partition's leader load.

Bulker now consumes all partitions assigned to its group member. Each scheduled run
snapshots an end offset per partition. A destination batch may contain records from
several partitions; only their completed offsets are committed after the destination
completes. Failed batches are replayed by partition range, and retry/dead-letter
publication commits the corresponding source offsets in the same Kafka transaction.
Assignment epochs fence work from before a rebalance. Kafka commit failures after a
successful destination load cause replay from Kafka's checkpoints (possible duplicates),
not an administrative rewrite of the group's offsets.

This remains at-least-once delivery. There is no ordering across partitions, and
increasing partition count can change key routing. Enable it only for destinations
that tolerate this, starting with append-only backups. One batch topic still has one
scheduled destination writer under the current sharding scheme; this distributes
Kafka traffic, not destination writes. Ordinary batch consumers verify against fresh
broker metadata that they own **all** partitions before starting a run. If multiple
instances share a logical shard and Kafka splits the assignment, they fail closed
with `exclusive_assignment_required`; consumption resumes once one member owns the
whole topic. Keep one active instance per logical shard (and stable instance IDs
across replacements). Concurrent destination writers need a separate design for
object naming and destination transaction semantics. Retry groups can assign multiple partitions
per member. Physical Kafka partitions are independent of logical `.p.N` topic names.

## Configuration

The default is one partition. Supply an exact-topic JSON allowlist on Bulker:

```sh
BULKER_KAFKA_BATCH_TOPIC_PARTITIONS='{"in.id.WORKSPACE_backup.m.batch.t.backup":4}'
```

Only batch-mode topics and positive integer counts are accepted. Include any topic
prefix in the exact name. This controls creation of new topics. To increase an
existing topic, also set:

```sh
BULKER_KAFKA_BATCH_TOPIC_PARTITION_EXPANSION=true
```

The topic manager reconciles configured, active destination topics on their owning
shard. It validates Kafka's per-topic result and retries failures on later metadata
refreshes. It never decreases a partition count. Removing the setting or lowering
the configured count leaves an expanded topic unchanged. Producer-only topic
managers do not reconcile existing topics; configure the consumer-owning Bulker
instances. If another service creates the topic first at one partition, reconciliation
requires the expansion flag.

## Rollout and rollback

1. Deploy compatible consumers to **every** Bulker instance with the allowlist empty
   and expansion disabled. Verify ordinary single-partition batch/retry behavior.
2. Select one large backup topic, record its partition count, group checkpoints,
   throughput and lag, and confirm adequate broker storage/replication capacity.
3. Set the exact-topic count and expansion flag on all Bulker instances. Kafka
   partition expansion is irreversible; do not expand while legacy consumers can
   still own the topic. A consumer rebalance and producer metadata refresh follow.
4. Confirm new partitions receive traffic and are assigned/committed. Backup writes
   use event keys and `PartitionAny`; verify that actual key distribution spreads
   traffic. Additional partitions help only when their leaders distribute the load.
5. Disable the expansion flag after convergence. Keep compatible consumers deployed.
   Rollback means disabling further expansion or deploying a compatible fix, **never**
   redeploying a version that assumes exactly one assigned partition. Returning to
   one partition requires a separate drain-and-topic-migration plan.

## Observability and validation

`bulkerapp_consumer_queue_size` keeps its existing labels and now sums lag across
this member's assigned partitions. The new
`bulkerapp_consumer_partition_queue_size` uses the same labels plus `partition`.
Both report batch snapshots, not continuously sampled broker state; offset lag can
include transaction markers. Per-partition series are refreshed when ownership is
sampled on the next run. Logs include partition-specific start/end offsets.

Before broad rollout, compare one partition with the selected count using
representative backup event sizes and burst rates (the motivating incident reached
about 20k messages/s). Measure ingest backup queue count/bytes/errors, per-partition
lag and leader throughput, broker disk/network/request latency, destination batch
latency, and recovered event counts. Include a broker interruption, a consumer
restart and destination failure. Do not infer production capacity from a single-broker
local test; expansion cannot fix an aggregate broker or destination bottleneck.

Tests cover interleaved/idle partitions, bounded snapshots, offset result errors,
retention/truncation resets, real Kafka retry transactions and live expansion.
Run from `bulker/bulkerapp`:

```sh
go test -race ./app -count=1
```

The app integration suite uses local Docker Kafka/Postgres fixtures with fixed
ports/names; run only one copy at a time. Static-member replacement tests separately
require `BULKER_TEST_KAFKA_BOOTSTRAP_SERVERS` pointing to an isolated test broker.
