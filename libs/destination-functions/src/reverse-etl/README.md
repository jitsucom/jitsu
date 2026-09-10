# Reverse ETL writer protocol (JITSU-227)

Second, stacked implementation slice: destination contracts and an upsert lifecycle core.
This is not a runnable CronJob yet. No advertising provider is registered or enabled.

- Browser code imports `./meta` only; server code imports `./index`. Existing event destinations remain unchanged.
- Provider streams will live beside their event implementations in `src/functions`, under `builtin.reverse.<type>`.
- The caller supplies a fenced Go-sidecar `DeliveryJournal`. There is no production in-memory persistence fallback.
- The sidecar must persist encrypted prepared payloads, bind target/revision/run/epoch, refuse unresolved recovery work, validate contiguous receipts and atomically commit state/outbox. Those RPCs/migrations are the next slice.
- Batches remain in source order. Kind changes, size limits and checkpoint barriers flush the current bounded buffer.
- Any staged outcome inhibits subsequent checkpoints until finish acceptance is durably acknowledged. The journal owns large manifests; Node retains one batch, not a per-run ID set.
- Provider throws/malformed responses remain uncertain and fail closed; provider-specific bounded safe retry/reconciliation will be implemented with each verified adapter.
- Every valid result is acknowledged before acting on permanent rejection or cancellation. Permanent errors never skip a row.
- Remote cleanup also requires fenced `prepareAbort` and `acknowledgeAbort`; stale workers cannot initiate it. Already-authorized in-flight requests/cleanup still require reconciliation: this is not atomic provider-side fencing.
- Finish is explicit even for empty input. Pending finish preserves recovery context, never calls abort merely because processing is pending, and never commits completion.
- Mirror contracts are defined, but the runner refuses mirror until snapshot/membership recovery is implemented. No removals can be inferred by this core.
- Receipts/outbox are authoritative. Only accepted operations activate a monthly sync; staged work and operation counts are not invoice charges.
- Source factories adapt warehouse readers and must enforce primary-key uniqueness, cancellation and cleanup. Use lossless strings for large numeric/timestamp keys.
