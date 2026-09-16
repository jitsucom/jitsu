import type { JsonObject, ReverseEtlContext, ResumePoint } from "@jitsu/protocols/reverse-etl";
import { validateBatchResult, validateFinishResult } from "@jitsu/destination-functions/src/reverse-etl/meta";
import type { openPersistence } from "./persistence";
import { readSavedState, stateStream } from "./persistence/run-state";
import type { OperationRow, StateRow } from "./persistence/rows";
import { ensure } from "./persistence/types";
import type { RuntimeRecovery } from "./adapters";
import { mirrorDeliveryBatch } from "./mirror";

type Session = Awaited<ReturnType<typeof openPersistence>>;

/** Recover only durable work. Never infer source completion or reopen SQL here. */
export async function recoverRun(
  run: Session,
  ctx: ReverseEtlContext<JsonObject, JsonObject>,
  hooks?: RuntimeRecovery
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
  ensure(["running", "abort_prepared"].includes(status.phase), "Unsupported recovery phase");
  if (status.phase === "running") {
    let after = "";
    for (;;) {
      const page = await run.core.recoveryPage(after);
      if (!page.length) break;
      for (const entry of page) {
        ctx.signal.throwIfAborted();
        const saved = await run.core.recoveryBatch(entry.batchId);
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
        }
        after = entry.batchId;
      }
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
  return run.core.db
    .transaction(async client => {
      const last = await client.query<Pick<OperationRow, "batch_id">>(
        "SELECT batch_id FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND sequence=$4",
        [run.scope.workspaceId, run.scope.syncId, run.scope.logicalRunId, sequence]
      );
      if (last.rowCount) {
        // Loaded below via the journal after this short transaction exits.
        return { sourceSequence: sequence, batchId: last.rows[0].batch_id };
      }
      const result = await client.query<Pick<StateRow, "state">>(
        `SELECT state FROM ${run.core.db.stateTable} WHERE sync_id=$1 AND stream=$2`,
        [run.scope.syncId, stateStream]
      );
      const saved = result.rows[0]?.state;
      const value = saved ? readSavedState(saved, run.scope) : undefined;
      return {
        sourceSequence: sequence,
        ...(run.scope.extraction === "cursor" && value?.point.cursor ? { cursor: value.point.cursor } : {}),
      };
    })
    .then(async (point: ResumePoint & { batchId?: string }) => {
      if (!point.batchId) return point;
      const batch = await run.core.loadBatch(point.batchId);
      return { sourceSequence: sequence, ...(batch.cursor ? { cursor: batch.cursor } : {}) };
    });
}
