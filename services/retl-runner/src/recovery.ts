import type { JsonObject, ReverseEtlContext, ResumePoint } from "@jitsu/protocols/reverse-etl";
import { validateBatchResult, validateFinishResult } from "@jitsu/destination-functions/src/reverse-etl/meta";
import type { openPersistence } from "./persistence";
import { ensure } from "./persistence/types";
import type { RuntimeRecovery } from "./adapters";
import { mirrorDeliveryBatch } from "./mirror";

type Session = Awaited<ReturnType<typeof openPersistence>>;

/** Recover only durable work. Never infer source completion or reopen SQL here. */
export async function recoverRun(
  run: Session,
  ctx: ReverseEtlContext<JsonObject, JsonObject>,
  hooks?: RuntimeRecovery,
  independentBatches = false
) {
  const status = await run.core.recoveryStatus();
  const store = () => ctx.store.snapshot();
  if (status.phase === "init_prepared") {
    ensure(hooks?.reconcileInit, "Initialization requires provider reconciliation");
    const resolution = await hooks.reconcileInit(ctx);
    await run.core.resetInitAfterReconciliation(resolution, store());
    return "restart" as const;
  }
  if (["finish_prepared", "finish_pending", "finish_resolving", "finish_accepted"].includes(status.phase)) {
    if (["finish_prepared", "finish_pending"].includes(status.phase)) {
      ensure(hooks?.reconcileFinish, "Finalization requires provider reconciliation");
      const result = validateFinishResult(await hooks.reconcileFinish(status.finish, ctx));
      await run.core.acknowledgeRecoveredFinish(result, store());
      if (result.delivery === "pending") return "pending" as const;
    } else if (status.phase === "finish_resolving") {
      await run.core.acknowledgeRecoveredFinish({ delivery: "accepted" }, store());
    }
    const point = await finalPoint(run, status.nextSequence);
    await run.delivery.commitCheckpoint(point, store(), true);
    return "accepted" as const;
  }
  ensure(["running", "batches_pending", "abort_prepared"].includes(status.phase), "Unsupported recovery phase");
  if (["running", "batches_pending"].includes(status.phase)) {
    let after = "";
    let pending = false;
    let rejected = false;
    for (;;) {
      const page = await run.core.recoveryPage(after);
      if (!page.length) break;
      for (const entry of page) {
        ctx.signal.throwIfAborted();
        const saved = await run.core.recoveryBatch(entry.batchId);
        rejected ||= saved.operations.some(op => op.status === "rejected");
        if (saved.operations.some(op => ["prepared", "unknown", "staged"].includes(op.status))) {
          ensure(hooks?.reconcileBatch, "Batch requires provider reconciliation");
          // Upsert manifests already contain provider input. Mirror partial-source
          // recovery cannot have batches: it never writes before sealing.
          const wire =
            run.scope.mode === "mirror"
              ? mirrorDeliveryBatch(saved.batch)
              : (saved.batch as import("@jitsu/protocols/reverse-etl").WriteBatch<JsonObject>);
          const result = validateBatchResult(
            saved.batch,
            await hooks.reconcileBatch(wire, saved.batch.action, saved.result, ctx)
          );
          await run.core.acknowledgeRecovered(entry.batchId, result, store());
          pending ||= result.outcomes.some(outcome => outcome.status === "staged");
          // Known outcomes are durable before stopping on a permanent row failure.
          ensure(!result.outcomes.some(outcome => outcome.status === "rejected"), "Destination rejected a row");
        }
        after = entry.batchId;
      }
    }
    // Finish-staged sessions may require verified cleanup to resolve incomplete
    // extraction. Independent jobs must settle first; abort cannot cancel them.
    if (pending && (independentBatches || status.phase === "batches_pending")) return "pending" as const;
    if (status.phase === "batches_pending" && !rejected) {
      ensure(hooks?.attachWriter, "Finalization requires provider attachment");
      ctx.signal.throwIfAborted();
      const writer = await hooks.attachWriter(ctx);
      await run.delivery.prepareFinish(status.nextSequence, store());
      ctx.signal.throwIfAborted();
      const result = validateFinishResult(await writer.finish());
      await run.core.acknowledgeRecoveredFinish(result, store());
      if (result.delivery === "pending") return "pending" as const;
      await run.delivery.commitCheckpoint(await finalPoint(run, status.nextSequence), store(), true);
      return "accepted" as const;
    }
    ensure(hooks?.reconcileAbort, "Incomplete extraction requires verified cleanup");
    await run.delivery.prepareAbort();
  }
  ensure(hooks?.reconcileAbort, "Cleanup requires provider reconciliation");
  ctx.signal.throwIfAborted();
  await run.core.recoveryStatus();
  await hooks.reconcileAbort(ctx);
  await run.delivery.acknowledgeAbort();
  return "restart" as const;
}

async function finalPoint(run: Session, sequence: number): Promise<ResumePoint> {
  return run.core.finalPoint(sequence);
}
