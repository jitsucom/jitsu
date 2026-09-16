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
Returning `[]` deliberately excludes a valid source row from the desired audience.
Its source key is still validated, stored and checked for duplicates. Invalid rows
or projections must fail; never convert errors into empty results. A previously
tracked member becomes removable only when no source row projects it, after the
full snapshot is sealed and additions are accepted. An all-excluded snapshot is
a valid empty desired audience and still requires explicit finish and promotion.
Prepared provider delivery operations remain non-empty.
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

The caller must hold and renew the Kubernetes per-sync lease. PostgreSQL provides
atomic persistence, not a second worker lease or stale-worker fencing. The caller must verify
`targetBaseline`: `new-empty` means a new empty target; `tracked` means an exclusively
managed target whose complete baseline has been tracked/imported. An arbitrary
pre-existing audience is not valid. This library cannot discover/import remote
membership or verify account permissions itself.

## New run

1. Build a mirror/full `RunInput` and open `openMirrorPersistence` after Kubernetes admission.
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

`resumeSnapshotMirror` requires a recovery session and a sealed candidate. It has no
source argument and never invokes projection or `stream.createWriter`.

- `reconcileBatch` receives the exact persisted provider request, action, prior
  receipt and current context/store. Return verified outcomes or perform a
  provider-proven safe idempotent replay; missing IDs do not prove absence.
  State changes use explicit core reconciliation methods.
- `attachWriter(context)` reattaches the verified existing session using the recovered context
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
  reset/reopen path. Unknown remote state remains blocked.

The caller owns maintenance, task/log state, timeouts, lease renewal, cancellation
and provider reconciliation policy. These remain executable-runner work, not
background loops silently started by this library.

## Tests

From `services/retl-runner`, run `pnpm test` against disposable PostgreSQL with
restricted runtime roles. `RETL_MIRROR_SCALE_TEST=1 pnpm test` also seeds one million
synthetic desired SQL rows and checks bounded diff pages. This validates pagination,
not million-row serialization/extraction or provider throughput. No production database
or advertising API is touched.
