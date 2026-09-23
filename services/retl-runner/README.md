# Reverse ETL Node core — JITSU-227

Server-only persistence, snapshot mirroring and an executable Node runner.
See [runtime integration](src/runtime.md) for syncctl/CronJobs, admission,
Kubernetes leases, task logs and recovery, and [snapshot mirroring](src/mirror.md)
for the full-source lifecycle.

## Storage and deployment

[Object-backed persistence](src/artifacts/README.md) is the sole backend:
local SQLite indexes source keys and audience identities; GCS/S3 stores immutable
snapshots, batches and receipts; PostgreSQL holds only small control records.
Object storage is required. There is no per-row PostgreSQL fallback or SQL sweeper.

**This rollout drops six old payload tables and five accounting columns.** Follow
the linked cutover instructions: pause schedules and drain old workers, back up
state, resolve remote requests, explicitly reset/retire test syncs and audiences,
then apply Prisma and deploy the new runner. No automatic migration/reset is
provided. Keep deployment manual; do not apply the schema while old workers run.

Only `reverse_sync_control` and `reverse_sync_target_owner` are Reverse ETL-specific
PostgreSQL tables. Shared `source_state`, `source_task`, and `task_log` retain their
existing purposes. Prisma defines the schema and generated row types alongside
console tables; runtime queries use `pg`. No separate database schema, runtime
DDL, supplementary SQL migrations, or schema-owner runner credentials.

Provision a restricted runtime login outside this package:

```sql
GRANT USAGE ON SCHEMA newjitsu TO retl_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  newjitsu.reverse_sync_control, newjitsu.reverse_sync_target_owner TO retl_runtime;
GRANT SELECT, INSERT, UPDATE ON newjitsu.source_state, newjitsu.source_task TO retl_runtime;
GRANT INSERT ON newjitsu.task_log TO retl_runtime;
```

Change `newjitsu` for another configuration schema. The connection URL's `schema`
parameter defaults to `public`; structured pg options default to `newjitsu`.
`sourceSchema` overrides either. Transactions set a validated local search path
with `pg_catalog` first and `pg_temp` last. The pool caps connections at four,
acquisition at 5s, statements/idle transactions at 10s, and lock waits at 3s.
SQL errors are redacted. Prisma Client is a development dependency, not a runtime
client; run `pnpm codegen` before typechecking.

## Provider boundary

`openPersistence(db, run, project)` returns:

- `scope`: immutable workspace/sync/run/task/target/revision binding.
- `delivery`: the existing `DeliveryJournal` facade for `ctx.delivery`, without
  database, snapshot or core-recovery methods.
- `core`: recovery reads and reconciled acknowledgements; never pass to writers.
- `snapshots`: core-only desired/effective indexing, sealing and diff pages.

The pure `project(action, row)` callback yields bounded provider-ready identities
and upsert/removal values. Explicit removals must use the same canonical identity
as upserts; do not hash stored removal identifiers again. Mirror manifests carry
normalized Effect envelopes; provider calls receive only their payloads.

## Ownership and recovery

The caller holds and renews the per-sync Kubernetes Lease throughout admission,
artifact restoration/compaction and delivery, and stops on Lease loss. Kubernetes
and syncctl are the only worker coordination mechanism. Target ownership is a
separate persistent claim: different syncs must not manage the same mirror audience.
Mirror admission also checks other syncs' unfinished control records because upsert
syncs do not claim ownership. Only durable `complete`/`aborted` controls are ignored;
detached or failed/cancelled tasks with unresolved work still block takeover. Old
control records remain recovery/audit evidence, not a permanent ownership lock.
The ownership claim itself is retained after completion and sync deletion. This
does not add automatic release, transfer another sync's baseline, or make a
replacement mirror safe without its normal audience admission requirements.

Read-only control observations use an in-memory cache. Short SQL transactions
publish artifact pointers and lifecycle/store/checkpoint changes atomically.
State transitions check the expected phase; artifact mutations compare the durable
head. These checks are atomicity guards, not worker leases. No object I/O occurs
inside a SQL transaction. Failed/ambiguous SQL commits require reopening the
artifact session; never assume an upload means the commit succeeded.

Prepared batches are durable before provider calls. Recovery uses
`recoveryStatus`, `recoveryPage`, `recoveryBatch`, and `loadBatch` without rerunning
changed warehouse SQL. Unknown outcomes require provider reconciliation; missing
receipts never authorize blind replay. Recovered acceptance uses core-only
`acknowledgeRecovered` / `acknowledgeRecoveredFinish`.

Interrupted initialization requires verified absence or cleanup before
`resetInitAfterReconciliation`. Reopen the same logical run after that reset.
Already-accepted finish processing can resume locally from `finish_resolving`
without another provider call. Its saved timestamp is reused for staged receipts.

Terminal receipts are immutable. Identical staged/terminal retries are read-only
and do not overwrite newer stores. Advancing staged outcomes preserves already
terminal outcomes and pending job metadata. Accepted membership changes survive
failed/aborted runs; local sequence tombstones prevent late acknowledgement from
resurrecting an older value. Acknowledgement times are runner timestamps, not
provider delivery times or billing attribution.

## Snapshot guarantees and budgets

Snapshot pages are collected in ephemeral SQLite with unique source keys,
including deliberately excluded rows. Shared destination identities collapse
only when their entire normalized payload agrees. Page retries compare canonical
content; changed retries, gaps and duplicate source keys fail. An incomplete
snapshot is not recoverable extraction progress: reconcile/abort, start a new
logical run and collect full input again. A sealed snapshot is durable in artifacts.

Local indexed joins produce bounded additions/updates/refreshes/removals. Removals
require sealed input and accepted additions. Final completion verifies effective
membership and commits checkpoint/generation state together. Writers have no
snapshot method. The next logical run compacts receipts into a membership baseline.

Defaults: 1,000 records / 10 MB per batch, 100 identities per source row, 1 million
projected occurrences / 256 MB per snapshot, 1 million effective identities /
256 MB membership, and 256 MB current-run journal budget. Excluded rows consume
one snapshot entry. Snapshot bytes account for serialized source-key/effect pages;
membership bytes account for normalized values. Reservations conservatively cover
pending additions, including updates. Smaller limits may be configured.

Artifacts are individually bounded to 16 MB, checksummed and scope-bound.
Provider state is capped at 64 KiB; finish metadata at 384 KiB; checkpoint
cursor/store envelope at 192 KiB. No application encryption or billing logic.
Protect identifiers, payloads, provider state, backups and buckets using restricted
IAM, infrastructure encryption and retention policies.

**No automatic object garbage collector.** Retain referenced baselines and
unresolved batches indefinitely; do not use age-only bucket lifecycle deletion.
See the storage document for orphan cleanup and coordinated rollback precautions.

## Task batch statistics

The runner publishes aggregate batch outcomes to `source_task.metrics.reverseDelivery`
after durable state changes and on restore. No rows, identifiers, receipts, or object
keys are copied into metrics. The console uses these counters in the sync/task status
dropdown; deploy the updated runner to populate them. Older attempts without these
metrics show statistics unavailable. No schema migration is required.

Counts cover the entire logical run as last observed by this attempt, including work
from earlier attempts. Totals count batches created so far, not an estimated final
batch count. Each batch belongs to exactly one outcome within upserts or removals;
pending takes precedence over partial acceptance, and mixed final results are separate
from fully accepted/rejected batches. Full-audience cleanup is a separate operation,
not an invented removal batch or removed-member count. Record acceptance is not
Google's matched audience size. Historical attempts retain their own observation.

Statistics failures do not fail delivery; unchanged aggregates are not rewritten.
The existing status-refresh schedule shares the metrics object and is preserved.

## Validation

`pnpm --filter @jitsu-internal/retl-runner test` uses disposable PostgreSQL 18,
restricted runtime roles, real local SQLite and an immutable in-memory object
service (tests only). It checks schema reapplication, absent payload tables,
lifecycle/recovery, partial failure, SQL ambiguity and artifact restoration.
Cloud tests use a local HTTP S3 fixture and GCS stream doubles. No live database,
advertising API, deployment bucket or deployment is used.
