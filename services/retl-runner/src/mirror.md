# Core snapshot mirroring

This is a server-only library slice, stacked on PostgreSQL persistence. It does not
enable a live adapter, executable job, scheduling, UI, billing or native audience
replacement. The existing upsert lifecycle still rejects mirror mode; use this
separate core lifecycle when wiring the executable runner.

## Adapter and admission

`SnapshotMirrorAdapter<C, Row, O>` combines a normal destination stream with a pure
`MirrorProjection<Row>` (`rowType` and `project`). The projection returns bounded
provider-ready `{ identity, upsert, remove }` values, deterministic for the immutable
configuration revision. The core validates both output payloads against the stream
schemas, enforces unique source keys, and rejects conflicting shared identities.
Schema transforms must already be applied by the projection; validation cannot
silently alter the stored provider payload.
The canonical identity must include everything needed to identify a removable
remote member; its removal payload must depend only on that identity and immutable
configuration, not mutable source attributes.

Adapters must declare `batchDelivery: "accepted"`, snapshot-diff capability and
explicit removal support. Finish-staged/native replacement strategies are rejected.
Unexpected staged outcomes are journaled but cannot authorize removals.

Use `openMirrorPersistence` to bind the journal to normalized effect envelopes.
Do not pass an ordinary row-projecting persistence session: it could normalize/hash
an identifier twice. A private session marker rejects that accidental combination.

The caller must hold and renew the Kubernetes and PostgreSQL leases. It must verify
`targetBaseline`: `new-empty` means a new empty target; `tracked` means an exclusively
managed target whose complete baseline has been tracked/imported. An arbitrary
pre-existing audience is not valid. This library cannot discover/import remote
membership or verify account permissions itself.

## New run

1. Build a mirror/full `RunInput` and acquire `openMirrorPersistence`.
2. Supply `runSnapshotMirror` with the session, adapter, runtime context,
   verified baseline, mapping and a lazy complete cursorless `source`.
3. The core initializes the writer, collects/validates the full desired snapshot,
   then seals it before sending any additions/removals.
4. Bounded additions must all be durably accepted before removal planning starts.
   Requests obey both provider row limits and the configured manifest byte limit.
5. Explicit `finish()` handles empty/unchanged snapshots too. Only accepted finish
   can atomically commit state and promote the generation; pending finish cannot.

Writers receive the ordinary context and journal facade, never snapshot storage,
database access or a diff API. Journal manifests carry core `Effect` envelopes;
provider requests contain their stored `upsert`/`remove` payloads with the same IDs.
`mirrorDeliveryBatch` performs this conversion without normalization. Mirror
operation keys are identity hashes; model keys enforce source uniqueness without
source-to-identity association rows. The returned `sourceSequence` counts delivery
operations, not source rows or a full-query extraction offset.

Known outcomes are persisted even when a row is rejected or cancellation arrives
during a request. Permanent rejection stops immediately. Accepted effects survive
abort and participate in later diffs. Uncertain calls and started finalization do
not trigger cleanup that could erase recovery evidence.

## Recovery

`resumeSnapshotMirror` requires a recovery epoch and a sealed candidate. It has no
source argument and never invokes projection or `stream.createWriter`.

- `reconcileBatch` receives the exact persisted provider request, action, prior
  receipt and current context/store. Return verified outcomes or perform a
  provider-proven safe idempotent replay; missing IDs do not prove absence.
  State changes use explicit core reconciliation methods.
- `attachWriter(context)` reattaches the verified existing session using this epoch
  and buffered store. It must not blindly create a new remote session and is only
  invoked when further delivery is needed.
- `reconcileFinish` handles prepared/pending finalization. Already accepted/local
  finish resolution and final checkpoint retries need no provider call or writer
  attachment. Reconciled store changes share the receipt/checkpoint transaction.
- Diff reads restart from acknowledged membership, skipping accepted effects
  without a mutable diff cursor or warehouse re-extraction.
- Incomplete extraction cannot resume from changed SQL. Reconcile/abort the old
  session, acquire a new logical run, prune its abandoned candidate and collect a
  new full source. Interrupted initialization uses persistence's explicit init
  reset/reacquisition path. Unknown remote state remains blocked.

The caller owns maintenance, task/log state, timeouts, lease renewal, cancellation
and provider reconciliation policy. These remain executable-runner work, not
background loops silently started by this library.

## Tests

From `services/retl-runner`, run `pnpm test` against disposable PostgreSQL with
restricted runtime roles. `RETL_MIRROR_SCALE_TEST=1 pnpm test` also seeds one million
synthetic desired SQL rows and checks bounded diff pages. This validates pagination,
not million-row serialization/extraction or provider throughput. No production database
or advertising API is touched.
