# Object-backed Reverse ETL persistence — JITSU-227

The sole persistence backend, replacing network-database row storage. Node >=22.13 is required
(`node:sqlite`; the runner image should use Node 24). No sidecar or MongoDB service.
Existing destination interfaces and syncctl recovery scheduling are unchanged.

## Storage contract

- PostgreSQL `reverse_sync_control` still owns the current run/phase, target and
  revision binding, provider store, and checkpoint boundary. Its nullable
  `artifact_head` is a small versioned reference, not a member payload.
- The referenced immutable manifest contains the baseline parts, sealed desired
  snapshot parts, and batch descriptors. Batch manifests and detailed receipts
  are separate compressed JSON artifacts. There is no per-member or per-operation
  PostgreSQL write. Capacity is checked from the local index and artifact manifest.
- Local SQLite holds unique source keys, deduplicated desired members, effective
  membership, operation outcomes and touched identities. It is created in a
  private temporary directory, with a 0600 file, a bounded cache and 1 GiB main
  database cap. Provision sufficient ephemeral disk; it is not durable state.
- PostgreSQL retains only `reverse_sync_control`, `reverse_sync_target_owner`, and
  shared `source_state`, `source_task`, `task_log`. The six legacy payload tables,
  old accounting columns, backend fallback and SQL retention sweeper are removed.

Snapshot ingestion performs local indexed writes. Duplicate source primary keys
fail; shared destination identities collapse only when their entire normalized
payload agrees. Local joins produce bounded additions/updates/refreshes/removals.
An unsealed scratch snapshot can be discarded after a crash: no batches may be
submitted against it. A sealed snapshot is uploaded before publishing its head.

Before every destination batch, upload its exact manifest/effects and publish a
prepared descriptor. A receipt is uploaded before atomically publishing its
reference together with the provider store. Checkpoints update `source_state` and
the control row in the same short transaction. No object I/O happens while holding
a PostgreSQL transaction. Failed/ambiguous SQL commits poison the local session;
reopen from the database head, never assume the upload means the commit succeeded.

On recovery, restore baseline parts and replay batch receipts into SQLite. Pending
requests still require provider reconciliation; absent receipts do not authorize
replay. Accepted effects survive rejected rows, aborted runs and restarts. Local
sequence tombstones prevent late acknowledgements from resurrecting an identity
removed by a later accepted operation. Before the next logical run, compact the
effective membership into baseline parts, then atomically publish the new head.
Membership refresh timestamps survive replay/compaction; candidate refresh cutoff
is fixed at snapshot creation.

Artifacts are scoped to workspace, sync, configuration revision and target. Each
reference contains an immutable key, SHA-256 of uncompressed content and exact
compressed/uncompressed sizes. Reads fail closed on missing/corrupt/cross-scope
data. Each object is capped at 16 MB and each object request at 60 seconds. Existing
snapshot/journal budgets still apply. GCS uses create-if-absent generation
preconditions; S3 uses `If-None-Match: *`. Existing objects are verified on retries.

Kubernetes Lease ownership must remain live during restoration, compaction and
delivery. The database head comparison is an atomic state update, not an additional
worker lease. The runner renews its Lease while opening artifact persistence.

## Deployment

This is a **destructive schema cutover**, not an additive rolling deployment.
Before applying Prisma schema changes:

1. Pause all Reverse ETL schedules and stop/drain old workers. Keep them disabled.
2. Back up the database and reconcile outstanding provider requests using the old
   runner/schema. Retire/reset test syncs and audiences explicitly as described below.
3. With operator approval, apply the console Prisma schema using schema-owner
   credentials. It adds `artifact_head`, drops the six legacy payload tables
   (`reverse_sync_batch`, `reverse_sync_operation`, `reverse_sync_generation`,
   `reverse_sync_source_key`, `reverse_sync_desired`, `reverse_sync_membership`),
   the unused action enum and five accounting columns. Prisma may require explicit
   data-loss confirmation; do not bypass it in unattended deployment.
4. Configure object storage and deploy the new runner. Create/verify a fresh disabled
   test sync before enabling it. Old control rows without artifact heads remain rejected.

No runtime DDL, automatic reset, or live schema change is part of this PR.

For an existing development checkout, remove the six obsolete generated files
`webapps/console/prisma/schema/reverse_sync_{batch,operation,generation,source_key,desired,membership}.ts`
before running `pnpm codegen`. They are ignored build artifacts, not schema source;
the Zod generator does not remove files for deleted models. Fresh checkouts do not
need this cleanup. Do not edit or delete the Prisma schema itself.

Configure the existing syncctl `ReverseRuntimeSecret` with:

```text
RETL_OBJECT_STORE=gcs             # or s3
RETL_OBJECT_BUCKET=your-private-bucket
RETL_OBJECT_PREFIX=reverse-etl/   # optional
```

GCS uses Application Default Credentials; in GKE use Workload Identity on the
runner service account. Destination Google Ads OAuth is unrelated and is never
used for artifact access. For S3-compatible storage, optional settings are:

```text
RETL_S3_REGION=us-east-1
RETL_S3_ENDPOINT=https://your-s3-compatible-service
AWS_ACCESS_KEY_ID=...             # omit when using supported workload identity
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...             # optional
```

The endpoint is trusted operator configuration, not a destination option. Custom
S3 endpoints use path-style addressing and must honor conditional writes. Runner
credentials need object create/read access under the configured prefix; no public
bucket access or object delete permission is needed. Configure provider encryption
at rest, restricted IAM and audit logging. Hashing identifiers does not make these
files non-sensitive. No application-level encryption is introduced.

`RETL_OBJECT_STORE` and `RETL_OBJECT_BUCKET` are required for every runner.
Missing configuration fails immediately; there is no PostgreSQL payload fallback.
Keep bucket/prefix stable across workers.

## Explicit test-sync reset (no migration)

Per the rollout decision, this PR does **not** migrate existing per-row state or
automatically reset it. Every pre-existing control row without an artifact pointer
is rejected, including phase `new`. New admission uploads an empty manifest first
and inserts its pointer atomically with the control row, so interrupted startup
remains recoverable without being confused with legacy state. Merely clearing the
artifact pointer is not a supported rollback/reset.

Safest development cutover: pause the old sync, resolve any unknown/pending provider
requests, retire that test audience, and create a new disabled sync with a **new
Jitsu-managed empty audience**. Enable it only after storage access and schema
deployment are verified. A fresh upsert sync may target an existing audience, but
does not inherit its membership or acquire permission to mirror it.

Reusing an old mirror audience requires a separately verified baseline or an
explicitly confirmed provider-side cleanup; deleting database state alone is not
safe. Do not delete ownership/recovery evidence while a worker or remote request
can still mutate the old audience. This PR contains no automatic destructive reset.

## Retention and rollback

Do **not** configure age-only lifecycle deletion on this prefix. An old baseline
or unresolved batch may remain necessary indefinitely. Every published head's
baseline, snapshot, batch and receipt references must remain readable. Uploads
whose SQL commit failed can leave harmless orphans.

Automatic object garbage collection is deliberately not included in this first
rollout. Reclaiming orphans requires a reachability-aware collector coordinated
with active publishers; never infer liveness from age or object listing alone.
Until then, budget/monitor bucket growth and retain objects. Dropping a bucket or
pointing to an empty bucket is not a reset. Database backups require the referenced
artifacts to be retained too.

Legacy workers must not run an artifact-backed sync. Roll back code only after
pausing all Reverse ETL syncs. Older binaries require the removed tables and cannot
recover new-format state. A rollback requires a coordinated database backup restore
and provider-side reconciliation, not just unsetting storage settings.

## Verification

`pnpm --filter @jitsu-internal/retl-runner test` uses disposable PostgreSQL and an
immutable in-memory object service (tests only). Tests cover 1000-row constant-SQL
batches, cross-worker async mirroring/removals, partial failure, lost scratch state,
failed SQL commits/uploads, corruption, deduplication and receipt ordering. No
warehouse, advertising account or deployment bucket is mutated by these tests.
