# Reverse ETL Node persistence — JITSU-227

Server-only persistence foundation on merged #1509. This package is not yet an
executable runner and does not enable advertising writes, CronJobs or mirror mode
in the lifecycle library. The closed ClickHouse failover PR #1512 is not included.

## Setup and boundaries

All `reverse_sync_*` tables are defined in `webapps/console/prisma/schema.prisma`
alongside `source_state`. They use the same configuration database schema. Apply
them through the existing console `db:update-schema` command with schema-owner
credentials; do not give the runner DDL access. The existing Prisma `db push`
workflow manages all tables, enums, keys and indexes. There is no separate Reverse
ETL migration, `retl` schema, supplementary SQL, or custom schema-update command.
No DDL runs on module import or runner startup. `pg` still handles runtime locking,
fencing and transactions; the runner does not need Prisma Client.

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

Construct a `Cipher` using an explicit 32-byte AES-256-GCM keyring and active key
ID from runtime secrets; there is no fallback key. Keys never enter SQL. Random
nonces and authenticated workspace/sync/purpose binding protect manifests,
provider state, replay data and recoverable identities. Keep old keys available
until their retained data has been re-encrypted or expired. Hashes are also
sensitive; the runtime role is trusted, not a tenant-facing database account.

`openPersistence(db, run, project)` returns:

- `scope`: immutable run/target/revision/epoch binding.
- `delivery`: the existing `DeliveryJournal` facade, suitable for `ctx.delivery`;
  no database client, encryption keyring, snapshot or core-recovery method.
- `core`: bounded recovery reads and acknowledgements; never pass this to writers.
- `snapshots`: core-only desired/effective storage, diff pages and sealing.

The pure `project(action, row)` callback is supplied by the core and yields bounded
provider-ready identity/upsert/removal values. This module hashes canonical JSON,
not identifiers according to vendor rules. Provider normalization and the core
mirror planner are the next slice. Explicit remove projection must yield the same
canonical identity as upsert; never hash stored removal identifiers again.

## Ownership and recovery

The caller must hold the matching Kubernetes per-sync lease **before** opening or
renewing this database owner. Wiring this admission check, renewal loop, task/log
updates and signal handling belongs to the executable runner/syncctl slice. This
module supplies the database half of fencing, not a replacement scheduler/lease.

Every run transaction locks and validates workspace, sync, logical run, task,
revision, target and epoch against the database clock. It checks expiry again
before commit. `renew` cannot resurrect an expired owner; `release` invalidates
ownership without inferring delivery success. An expired unfinished run can only
be acquired for recovery under its original logical run/configuration. New runs
are admitted only after complete or acknowledged abort. Config/target/mode changes
fail closed until the controlled-reset workflow is implemented.

Mirror target ownership persists beyond lease expiry. Other mirror/upsert syncs
cannot claim that audience. Conversion of an existing upsert target into exclusive
mirror ownership requires the later controlled-transfer workflow. Database fencing
cannot fence an already-authorized request inside a remote advertising API.

Prepared manifests are encrypted and durable before returning. Recovery uses
`recoveryStatus`, `recoveryPage`, `recoveryBatch` and `loadBatch`; it does not rebuild
an uncertain request from a changed warehouse query. Verify provider outcomes or
safe replay before acknowledgement. There is no automatic replay or blanket
"clear unknown" operation. Accepted/rejected receipts cannot be downgraded.

`acknowledgeRecovered` and `acknowledgeRecoveredFinish` are explicit core-only
reconciliation methods. Call them only after verifying provider outcomes; recovered
acceptance cannot be acknowledged through the writer facade. No billing period or
provider acceptance timestamp is required. Receipt `accepted_at` records the
database-clock time when Jitsu acknowledged the outcome, not remote delivery time.
Pending finish retains remote job IDs. Accepted finish resolves staged operations
in bounded transactions; a crash leaves `finish_resolving`, whose saved result and
acknowledgement timestamp allow local resolution to resume without submitting
provider finish again.

Checkpoints verify contiguous accepted receipts and the exact prepared batch-end
cursor. Full extraction checkpoints only at completion. The compact encrypted
`source_state` envelope stores cursor, sequence, provider store and generation
together; it is not a separate `_STORE_` write. Permanent rejections block progress.
Abort acknowledges cleanup of unaccepted staging only and preserves accepted work.

## Snapshot and delivery guarantees

Desired generations store unique source keys and deduplicated provider-ready
identities. Full-snapshot diffs need no stored source-to-identity associations:
an identity remains desired while any source row produces it. Conflicting shared-identity payloads are rejected. Effective
membership is updated on **every durable acceptance**, including failed runs.
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
256 MB effective membership, and 256 MB encrypted journal storage per sync.
The generation entry budget counts shared identities once per source occurrence
to bound projection work; its logical byte budget counts source-key hashes and
unique encrypted desired values, not PostgreSQL table/index overhead.
Provider state is limited to 64 KiB. These operational limits are unrelated to
billing; smaller limits can be supplied. Membership growth is conservatively
reserved before remote calls, including previously staged batches. Near a storage
cap even updates may require headroom; acceptance must not discover a predictable
storage limit after submission. Acknowledgement releases unused result reservations.
Ciphertext reservations include key-rotation overhead. Protocol responses have a
separate bounded envelope budget (including escaped job IDs/rejection reasons);
finish metadata is capped at 384 KiB and combined checkpoint state at 192 KiB,
without reducing the protocol's individual 64-KiB cursor/store allowances.

At most committed + candidate desired generations may be retained before another
candidate starts. Call fenced `prune` repeatedly to remove superseded/abandoned
snapshot data in bounded pages. Current candidate and committed generation are
never pruned. Receipt pruning takes an explicit retention cutoff (at least 24h),
deletes only old-run terminal receipts and encrypted manifests, and preserves
effective membership. The rollout must configure its
retention policy and invoke maintenance; this library runs no background sweeper.

## Validation

`pnpm --filter @jitsu-internal/retl-runner test` starts an isolated PostgreSQL 18
container and applies the canonical console Prisma schema using ordinary
Prisma `db push`. It also checks repeated schema updates, database constraints,
configured-schema routing and scoped runtime grants. Docker is required; there is no
in-memory substitute or silent integration-test skip. No external credentials,
production database, advertising API, or deployment is used.
