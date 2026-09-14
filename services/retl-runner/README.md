# Reverse ETL Node persistence — JITSU-227

Server-only persistence foundation on merged #1509. This package is not yet an
executable runner and does not enable advertising writes, CronJobs or mirror mode
in the lifecycle library. The closed ClickHouse failover PR #1512 is not included.

## Setup and boundaries

Apply `migrations/001-persistence.sql` **once**, with separate migration credentials,
to the configuration PostgreSQL database. The transaction creates an isolated
`retl` schema; console Prisma continues to own `source_state` and must not manage
these journal tables. No migration runs on module import or runner startup.

Provision a restricted runtime login outside this package, then grant:

```sql
GRANT USAGE ON SCHEMA retl, newjitsu TO retl_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA retl TO retl_runtime;
GRANT SELECT, INSERT, UPDATE ON newjitsu.source_state TO retl_runtime;
```

Change `newjitsu` and the `Database` option `sourceSchema` together if the config
database uses another schema. Never give runtime credentials migration ownership
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

`acknowledgeRecovered` and `acknowledgeRecoveredFinish` require verified acceptance
time and the corresponding customer billing period when newly recognizing remote
acceptance. If the outcome/time is unknown, leave it unresolved. Pending finish
retains remote job IDs. Accepted finish resolves staged operations in bounded
transactions; a crash leaves `finish_resolving`, whose stored acceptance evidence
allows restarting local resolution without submitting provider finish again.

Checkpoints verify contiguous accepted receipts and the exact prepared batch-end
cursor. Full extraction checkpoints only at completion. The compact encrypted
`source_state` envelope stores cursor, sequence, provider store and generation
together; it is not a separate `_STORE_` write. Permanent rejections block progress.
Abort acknowledges cleanup of unaccepted staging only and preserves accepted work.

## Snapshot and billing guarantees

Desired generations store unique source keys, shared identity associations and
provider-ready values. Conflicting shared-identity payloads are rejected. Effective
membership is updated on **every durable acceptance**, including failed runs.
Indexed keyset pages keep diff reads bounded. Removals require sealed valid input
and all desired additions accepted; no staged addition can authorize deletion.
Completion verifies membership equality and atomically promotes the generation
with final state. There is no standalone promotion call and no writer snapshot API.

Receipt, membership change, operation event and monthly activation commit together.
Activation is unique per workspace/sync/customer billing-period start. Accepted
then failed runs remain active; empty, staged-only and failed-before-acceptance runs
do not activate. Operation counts are telemetry, never an invoice meter. Billing
periods come from trusted admission, not a guessed calendar month. An expired
period blocks unproven acknowledgement until recovery supplies correct evidence.
Quota reservations, invoicing and commercial plan UI remain later work.

`publishOutbox` sends bounded pages with at-least-once delivery. Consumers must
deduplicate by event ID; publication is marked only after the callback succeeds.
Activation history and outbox events are independent of task/config retention.

## Budgets and retention

Defaults: 1,000 records / 10 MB per batch, 100 identities per source row, 1 million
associations / 256 MB per desired generation, 1 million effective identities /
256 MB effective membership, and 256 MB encrypted journal storage per sync.
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
effective membership, billing history and outbox. The rollout must configure its
retention policy and invoke maintenance; this library runs no background sweeper.

## Validation

`pnpm --filter @jitsu-internal/retl-runner test` starts an isolated PostgreSQL 18
container and applies the actual migration. Docker is required; there is no
in-memory substitute or silent integration-test skip. No external credentials,
production database, advertising API, or deployment is used.
