# Reverse ETL Node core — JITSU-227

Server-only persistence foundation on merged #1509. This package is not yet an
executable runner and does not enable advertising writes, CronJobs or mirror mode
in the lifecycle library. The closed ClickHouse failover PR #1512 is not included.

The separate server-only [snapshot-mirror lifecycle](src/mirror.md) now builds on
this persistence foundation: full source validation, bounded additions/removals,
explicit finalization and sealed-snapshot recovery. It does not enable the upsert
library's mirror path or deploy a production runner/provider.

## Setup and boundaries

All `reverse_sync_*` tables are defined in `webapps/console/prisma/schema.prisma`
alongside `source_state`. They use the same configuration database schema. Apply
them through the existing console `db:update-schema` command with schema-owner
credentials; do not give the runner DDL access. The existing Prisma `db push`
workflow manages all tables, enums, keys and indexes. There is no separate Reverse
ETL migration, `retl` schema, supplementary SQL, or custom schema-update command.
No DDL runs on module import or runner startup. `pg` handles runtime queries and
transactions. Prisma-generated model types describe database rows through a small
mapping for `pg`'s bigint strings and byte buffers; Prisma Client is a development
dependency only, not a runtime client. Run `pnpm codegen` before typechecking.

Provision a restricted runtime login outside this package, then grant:

```sql
GRANT USAGE ON SCHEMA newjitsu TO retl_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  newjitsu.reverse_sync_control, newjitsu.reverse_sync_target_owner,
  newjitsu.reverse_sync_batch, newjitsu.reverse_sync_operation,
  newjitsu.reverse_sync_generation, newjitsu.reverse_sync_source_key,
  newjitsu.reverse_sync_desired,
  newjitsu.reverse_sync_membership TO retl_runtime;
GRANT SELECT, INSERT, UPDATE ON newjitsu.source_state TO retl_runtime;
```

Change `newjitsu` in these grants if the config database uses another schema.
`Database` reads the connection URL's `schema` parameter (default `public` for a
URL without one); structured pg options default to `newjitsu`. `sourceSchema`
explicitly overrides either. Every transaction sets a validated local search path
with `pg_catalog` first and `pg_temp` last; pooled session state cannot redirect
reads or writes. Do not grant access to unrelated console tables.
Never give runtime credentials schema ownership
or DDL rights. The module caps its pool at four connections, acquisition at 5s,
statements/idle transactions at 10s, and lock waits at 3s. SQL errors are redacted.

Construct `Database` with the connection configuration and optional schema/limits.
Payloads are stored as readable JSON, with no application-level encryption,
keyring or AAD. Existing `bytea` columns contain versioned UTF-8 JSON; compact
checkpoint state is stored as JSON text inside the `source_state` envelope. This
preserves protocol strings (including NUL and unpaired surrogates) that PostgreSQL
`jsonb` cannot represent directly. There is no base64 encoding. No column migration
is required. Earlier encrypted development data is unsupported and rejected, not
silently interpreted as current state; this pre-rollout change provides no data
migration or automatic reset. Do not discard unresolved delivery evidence.
Audience identities, provider state and request payloads are sensitive. Protection
relies on restricted database/backup access, infrastructure encryption and retention.
The runtime role is trusted, not a tenant-facing database account. SQL errors remain
redacted; application encryption no longer protects database dumps or read access.

`openPersistence(db, run, project)` returns:

- `scope`: immutable workspace/sync/run/task/target/revision binding.
- `delivery`: the existing `DeliveryJournal` facade, suitable for `ctx.delivery`;
  no database client, snapshot or core-recovery method.
- `core`: bounded recovery reads and acknowledgements; never pass this to writers.
- `snapshots`: core-only desired/effective storage, diff pages and sealing.

The pure `project(action, row)` callback is supplied by the core and yields bounded
provider-ready identity/upsert/removal values. This module hashes canonical JSON,
not identifiers according to vendor rules. Provider normalization and the core
mirror planner are the next slice. Explicit remove projection must yield the same
canonical identity as upsert; never hash stored removal identifiers again.

## Ownership and recovery

The caller must hold and renew the matching Kubernetes per-sync lease **before**
opening persistence and throughout execution and maintenance. Kubernetes leases
and syncctl are the sole worker coordination mechanism. The caller must stop work
on lease loss. There are no database worker leases, epochs, or acquire/renew/release
APIs. A paused worker or an in-flight request is not forcibly fenced by this design.

Ordinary transactions and short control-row locks keep lifecycle transitions,
counters, receipts and checkpoints atomic. `readControl` checks workspace, sync and
logical run; it does not authorize a worker. An unfinished run must be reopened for
recovery under its original logical run/configuration. New runs are admitted only
after complete or acknowledged abort. Config/target/mode changes fail closed until
the controlled-reset workflow is implemented.

Persistent mirror-target ownership is separate from worker coordination: different
syncs must not manage the same audience. Other mirror/upsert syncs cannot claim that
audience. Conversion of an existing upsert target into exclusive mirror ownership
requires the later controlled-transfer workflow.

Prepared manifests are durable before returning. Recovery uses
`recoveryStatus`, `recoveryPage`, `recoveryBatch` and `loadBatch`; it does not rebuild
an uncertain request from a changed warehouse query. Verify provider outcomes or
safe replay before acknowledgement. There is no automatic replay or blanket
"clear unknown" operation. Accepted/rejected receipts cannot be downgraded.
Once a batch result is fully terminal, its complete receipt is immutable. Matching
retries are read-only and never overwrite a newer run store; conflicting metadata
is rejected. Identical staged/mixed receipts are read-only too, including after
takeover. A replacement must advance a staged outcome to accepted/rejected, preserve
already-terminal outcomes, and keep the original job IDs/checkpoint unchanged while
any staged outcomes remain. Once all outcomes are terminal, final metadata may replace
the pending metadata. Recovered transitions still require explicit core reconciliation.

`acknowledgeRecovered` and `acknowledgeRecoveredFinish` are explicit core-only
reconciliation methods. Call them only after verifying provider outcomes; recovered
acceptance cannot be acknowledged through the writer facade. No billing period or
provider acceptance timestamp is required. Receipt `accepted_at` records the
database-clock time when Jitsu acknowledged the outcome, not remote delivery time.

Initialization recovery uses a separate core-only transition. If takeover finds
`init_prepared`, inspect the saved store/provider state and verify that the old
initialization cannot still create a session: confirm absence, or safely finish
cleanup of the old session. Only then call
`core.resetInitAfterReconciliation("absent" | "cleaned-up", reconciledStore)`.
This atomically returns the lifecycle to `new`, clears obsolete provider state and
saves the reconciled store. An exact phase-`new` retry is read-only. Unknown/in-flight
initialization must remain blocked; this library does not infer remote absence from
missing IDs. A recovery session cannot directly acknowledge init or run fresh init.
Reopen persistence for the same logical run to reload the durable store,
and invoke the ordinary `runReverseEtl` lifecycle. This also works if the reset committed
but its response was lost. Already-initialized lifecycles cannot use this reset.

Pending finish receipts are immutable until accepted, preserving the original remote
job IDs and provider checkpoint. Matching retries are read-only, including their store
snapshot; conflicting pending receipts are rejected even through core recovery.
Accepted finish resolves staged operations
in bounded transactions; a crash leaves `finish_resolving`, whose saved result and
acknowledgement timestamp allow local resolution to resume without submitting
provider finish again.

Checkpoints verify contiguous accepted receipts and the exact prepared batch-end
cursor. Full extraction checkpoints only at completion. The compact JSON
`source_state` envelope stores cursor, sequence, provider store and generation
together; it is not a separate `_STORE_` write. Permanent rejections block progress.
Abort acknowledges cleanup of unaccepted staging only and preserves accepted work.

## Snapshot and delivery guarantees

`snapshots.start()` is idempotent for the current run's unsealed candidate, including
after takeover. Other abandoned generations still require pruning. Core-only
`snapshots.status()` returns absence or `{ sealed, lastPageSequence, sourceKeyCount }`.
Append source pages serially with `snapshots.append(rows, pageSequence)`, starting at
1. The generation stores only the latest page sequence and canonical content hash,
atomically with its rows and counters. An identical retry of that page is read-only;
changed/reordered content, older pages, sequence gaps and duplicate source keys in a
new page fail closed. Object-key ordering does not change the hash. Sealed snapshots
cannot be restarted or appended to; inspect status to resume planning instead.
The caller must reproduce the same page after an ambiguous write and must not submit
the next page until the previous one is acknowledged. These sequence numbers are not
warehouse cursors: resuming extraction still requires a stable/replayable source.

Desired generations store unique source keys and deduplicated provider-ready
identities. Full-snapshot diffs need no stored source-to-identity associations.
An empty mirror source projection deliberately excludes a valid row but retains
its source key and duplicate checks; invalid rows/projections still fail. Previously
tracked identities become removable only when no source row projects them.
Shared identities remain desired while any source row produces them. Conflicting shared-identity payloads are rejected. Effective
membership is updated on **every durable acceptance**, including failed runs.
For each identity, the latest accepted source-sequence operation wins, regardless
of acknowledgement order. An indexed hash list on each operation lets delayed staged
acceptance skip effects superseded by a later accepted upsert or removal, without
scanning/decoding the entire journal. The delayed operation still gets its acceptance
receipt and releases its reservation; other identities it affects still apply.
Current-run operations retain this ordering evidence until the run has ended, including
accepted removals, so no membership tombstone or extra table is needed. This is local
accounting order, not a guarantee of provider-side request ordering.
Indexed keyset pages keep diff reads bounded. Removals require sealed valid input
and all desired additions accepted; no staged addition can authorize deletion.
Completion verifies membership equality and atomically promotes the generation
with final state. There is no standalone promotion call and no writer snapshot API.

Receipt and effective-membership changes commit together. Accepted changes from
failed runs are preserved for later recovery or removal.

Billing is entirely deferred from this PR: no activation table, billing-period
inputs, usage outbox/publisher, entitlement enforcement, or invoicing. Durable
delivery receipts exist for recovery and are not a billing ledger.

## Budgets and retention

Defaults: 1,000 records / 10 MB per batch, 100 identities per source row, 1 million
projected identity occurrences / 256 MB per desired generation, 1 million effective identities /
256 MB effective membership, and 256 MB serialized journal storage per sync.
The generation entry budget counts shared identities once per source occurrence
and charges one entry for each excluded row to bound projection work; its logical byte budget counts source-key hashes and
unique serialized desired values, not PostgreSQL table/index overhead.
Provider state is limited to 64 KiB. These operational limits are unrelated to
billing; smaller limits can be supplied. Membership growth is conservatively
reserved before remote calls, including previously staged batches. Near a storage
cap even updates may require headroom; acceptance must not discover a predictable
storage limit after submission. Acknowledgement releases unused result reservations.
Byte reservations include the JSON format envelope. Protocol responses have a
separate bounded envelope budget (including escaped job IDs/rejection reasons);
finish metadata is capped at 384 KiB and combined checkpoint state at 192 KiB,
without reducing the protocol's individual 64-KiB cursor/store allowances.

At most committed + candidate desired generations may be retained before another
candidate starts. Call `prune` under the Kubernetes lease repeatedly to remove superseded/abandoned
snapshot data in bounded pages. Current candidate and committed generation are
never pruned. Receipt pruning takes an explicit retention cutoff (at least 24h),
deletes only old-run terminal receipts and manifests, and preserves
effective membership. The rollout must configure its
retention policy and invoke maintenance; this library runs no background sweeper.

## Validation

`pnpm --filter @jitsu-internal/retl-runner test` starts an isolated PostgreSQL 18
container and applies the canonical console Prisma schema using ordinary
Prisma `db push`. It also checks repeated schema updates, database constraints,
configured-schema routing and scoped runtime grants. Docker is required; there is no
in-memory substitute or silent integration-test skip. No external credentials,
production database, advertising API, or deployment is used.
