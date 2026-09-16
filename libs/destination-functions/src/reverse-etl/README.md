# Reverse ETL writer protocol (JITSU-227)

Second, stacked implementation slice: destination contracts and an upsert lifecycle core.
This is not a runnable CronJob yet. No advertising provider is registered or enabled.

## Package imports

Supported imports for TypeScript-aware consumers (such as the Node runner's bundler):

```ts
// Server only: runner lifecycle, registry and identity/state helpers.
import { runReverseEtl, createReverseEtlRegistry } from "@jitsu/destination-functions/src/reverse-etl/index";

// Browser-safe metadata validation; does not import the server runtime.
import { validateReverseEtlConfig } from "@jitsu/destination-functions/src/reverse-etl/meta";
```

The npm package includes `src/reverse-etl/**`, including both entry points and their
local dependencies. Like the existing package entry points, these ship as TypeScript
source, not precompiled JavaScript; compile/bundle them before running in plain Node.
No `exports` map is introduced, preserving existing deep imports. The root event
registry is unchanged and does not re-export the Reverse ETL server module.
The packaging smoke test runs an offline `npm pack --dry-run --ignore-scripts`.

## Design decisions

- Browser code imports `./meta` only; server code imports `./index`. Existing event destinations remain unchanged.
- Provider streams will live beside their event implementations in `src/functions`, under `builtin.reverse.<type>`.
- The caller supplies a PostgreSQL-backed `DeliveryJournal` implemented in the Node runner. Kubernetes leases and syncctl coordinate workers; the journal has no second worker lease or epoch. There is no Go sidecar, socket transport, or production in-memory persistence fallback.
- Persistence stores versioned JSON prepared payloads, binds workspace/sync/target/revision/run, refuses unresolved recovery work, validates contiguous receipts and atomically commits state. The Node persistence backend and recovery tests live in `services/retl-runner`; tables use the canonical console Prisma schema.
- Snapshot persistence, diff planning, effective membership, and generation promotion belong to the runner core. There is no `ctx.snapshot` or provider-facing `SnapshotStore`; the unused identity generic has been removed from writer context/stream types. The bounded provider KV `store.snapshot()` only serializes provider state and is unrelated to audience snapshots.
- Providers implement normalization/identity rules and remote `init/upsert/remove/finish/abort/reconcile` operations, not snapshot comparison. The core will use deterministic provider-ready identities for shared/changed-identity handling; writers must not infer removals or promote snapshot generations in `finish()`.
- Provider implementations receive the journal interface, not database clients or credentials. Only trusted built-in code runs in-process; this boundary is not a security sandbox. The runner uses restricted database credentials and bounded transactions/connections.
- The executable Node runner will own lease renewal, task/log persistence, and bounded graceful shutdown. syncctl/CronJobs retain scheduling/admission/cancellation and independent pod/task failure detection; controller container/status assumptions must be adapted. Existing connector sidecars are unchanged.
- Batches remain in source order. Kind changes, size limits and checkpoint barriers flush the current bounded buffer.
- Any staged outcome inhibits subsequent checkpoints until finish acceptance is durably acknowledged. The journal owns large manifests; Node retains one batch, not a per-run ID set.
- Provider throws/malformed responses remain uncertain and fail closed; provider-specific bounded safe retry/reconciliation will be implemented with each verified adapter.
- Init is prepared before the awaited writer factory; factory/init failures retain that manifest. Provider-created remote IDs must be persisted for recovery.
- Unacknowledged init/batch calls (including malformed results, failed acknowledgement or unknown-marker writes) suppress abort. Once outcomes are durable, abort may clean only unaccepted staging, never accepted delivery or recovery evidence.
- Every valid result is acknowledged before acting on permanent rejection or cancellation. Permanent errors never skip a row.
- Remote cleanup requires `prepareAbort` and `acknowledgeAbort` lifecycle transitions under the caller-held Kubernetes lease. Lease loss cancels the runner, but paused workers and already-started requests/cleanup are not forcibly fenced and still require reconciliation.
- Once provider finalization starts, errors/cancellation leave it to recovery instead of invoking `abort`: finalization may already have accepted delivery even when its acknowledgement/checkpoint fails.
- Explicit full refresh ignores the saved extraction cursor after recovery and never commits intermediate checkpoints, even when the reader emits cursor values. Accepted receipts/provider state remain available; this does not erase recovery data.
- Cursorless extraction always restarts at sequence zero after recovery admission, including subsequent completed runs; its saved sequence is receipt accounting, not a resumable offset. Final checkpoints retain the full accepted sequence for validation; no receipts are erased.
- Finish is explicit even for empty input. Pending finish preserves recovery context, never calls abort merely because processing is pending, and never commits completion.
- Cancellation is checked after durable finish acknowledgement for both accepted and pending results; a cancelled pending finish reports cancellation while retaining its remote job for recovery, without abort or checkpoint completion.
- Core-owned snapshot mirroring is required for the first production audience release. This foundation still refuses mirror until its runner-core planner, persistence and recovery tests are implemented; removing `ctx.snapshot` does not enable mirror execution. Verified provider-native replacement remains a later optional strategy, not the basis of generic mirroring.
- Receipts are recovery evidence, not a billing ledger. Monthly-active-sync billing is deferred; this implementation has no billing activation or outbox.
- Source factories adapt warehouse readers and must enforce primary-key uniqueness, cancellation and cleanup. Use lossless strings for large numeric/timestamp keys.
