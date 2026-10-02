import { randomUUID } from "node:crypto";
import type { JsonObject, ReverseEtlContext } from "@jitsu/protocols/reverse-etl";
import type { WarehouseReader, CompositeCursor } from "@jitsu/warehouse-query";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { createBufferedSyncStore, recordKey } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { runReverseEtl } from "@jitsu/destination-functions/src/reverse-etl/run";
import { requiresManualReconciliation } from "@jitsu/destination-functions/src/reverse-etl/failure";
import { Database, openPersistence } from "./persistence";
import type { ControlRow } from "./persistence/rows";
import { ensure, PersistenceResetRequiredError } from "./persistence/types";
import { openMirrorPersistence, runSnapshotMirror, resumeSnapshotMirror, MirrorRunError } from "./mirror";
import type { AdapterRegistry } from "./adapters";
import type { RunLease } from "./lease";
import { Tasks, type TaskResult } from "./tasks";
import { recoverRun } from "./recovery";
import { failureMessage, reportFailure, type FailureStage } from "./diagnostics";
import { RunProgress } from "./progress";

export interface ExecuteOptions {
  config: ReverseRunConfig;
  taskId: string;
  trigger: "manual" | "scheduled" | "recovery";
  recoveryOf?: string;
  workerId?: string;
  refreshAttempt?: number;
  db: Database;
  lease: RunLease;
  adapters: AdapterRegistry;
  controller: AbortController;
  /** Fresh console admission. No cached config fallback on errors. */
  admit(): Promise<ReverseRunConfig>;
  reader(config: Record<string, unknown>): WarehouseReader;
  heartbeatMs?: number;
}

export async function execute(input: ExecuteOptions): Promise<TaskResult> {
  const { db, lease, controller } = input;
  const tasks = new Tasks(
    db,
    input.config.id,
    input.recoveryOf ?? input.taskId,
    input.config.workspaceId,
    input.workerId ?? input.taskId
  );
  const progress = new RunProgress(
    message => tasks.progress(message),
    stats => tasks.statistics(stats)
  );
  let reportProgress: (() => Promise<void>) | undefined;
  let rejectedRows: (() => Promise<boolean>) | undefined;
  let refreshRunId: string | undefined;
  let deliveryFinished = false;
  let reader: WarehouseReader | undefined;
  let started = false;
  let held = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewing: Promise<void> | undefined;
  let leaseRenewal: Promise<void> | undefined;
  let stopped = false;
  let ownershipLost = false;
  let stage: FailureStage = "lease_acquire";
  const signal = controller.signal;
  // Provisioning and foreground admission share renewal with the heartbeat.
  // Parallel GET/PUT renewals would conflict on Kubernetes resourceVersion.
  const renewLease = () =>
    (leaseRenewal ??= lease.renew().finally(() => {
      leaseRenewal = undefined;
    }));
  const tick = async () => {
    try {
      await renewLease();
      await tasks.heartbeat();
    } catch {
      ownershipLost = true;
      controller.abort();
    }
    if (!stopped && !signal.aborted)
      timer = setTimeout(() => {
        renewing = tick();
      }, input.heartbeatMs ?? 10_000);
  };
  try {
    signal.throwIfAborted();
    await lease.acquire();
    held = true;
    stage = "task_start";
    refreshRunId = await tasks.start(
      input.trigger,
      input.recoveryOf,
      input.config.configRevision,
      input.refreshAttempt
    );
    started = true;
    stage = "admission";
    const config = ReverseRunConfig.parse(await input.admit());
    // Automatic checks are only queued with enabled snapshots. A pause after
    // queuing must still stop them; explicit paused refresh gets a paused snapshot.
    ensure(
      !config.options.disabled || (input.config.options.disabled && input.trigger === "recovery" && refreshRunId),
      "Paused sync only permits saved delivery status refresh"
    );
    stage = "execution";
    ensure(
      config.id === input.config.id &&
        config.workspaceId === input.config.workspaceId &&
        config.configRevision === input.config.configRevision,
      "Reverse configuration changed before admission"
    );
    signal.throwIfAborted();
    const bind = input.adapters.get(String(config.destination.destinationType));
    ensure(bind, "Reverse destination is not enabled in this runner");
    // Audience provisioning can outlive a lease period; supervise it just like delivery.
    timer = setTimeout(() => {
      renewing = tick();
    }, input.heartbeatMs ?? 10_000);
    const adapter = await bind(config, { db, signal, log: message => progress.log(message) });
    ensure(adapter.stream.name === config.options.stream, "Reverse stream does not match adapter");
    if (config.options.mode === "mirror")
      ensure(
        adapter.mirror && adapter.mirror.stream === adapter.stream && adapter.verifyMirrorBaseline,
        "Mirror adapter not verified"
      );
    const logicalRunId =
      refreshRunId ??
      (await db.transaction(async client => {
        const result = await client.query<Pick<ControlRow, "run_id" | "phase">>(
          "SELECT run_id,phase FROM reverse_sync_control WHERE workspace_id=$1 AND sync_id=$2 AND NOT detached AND phase NOT IN ('complete','aborted') ORDER BY run_order DESC LIMIT 1",
          [config.workspaceId, config.id]
        );
        const previous = result.rows[0];
        return previous && !["complete", "aborted"].includes(previous.phase) ? previous.run_id : randomUUID();
      }));
    // Recheck the Kubernetes lease before opening persistence. Durable state still
    // rejects changed revision/target/mode, but does not authorize worker ownership.
    await renewLease();
    signal.throwIfAborted();
    const runInput = {
      workspaceId: config.workspaceId,
      syncId: config.id,
      taskId: tasks.taskId,
      logicalRunId,
      targetIdentity: adapter.targetIdentity,
      configRevision: config.configRevision,
      mode: config.options.mode,
      extraction: config.model.cursor ? ("cursor" as const) : ("full" as const),
      insertOnly: adapter.insertOnly,
    };
    const mirror = config.options.mode === "mirror";
    // Restoring large object-backed baselines must not outlive worker ownership.
    const run = mirror
      ? await openMirrorPersistence(db, runInput)
      : await openPersistence(db, runInput, adapter.project);
    const scope = run.scope;
    run.core.onPublish = head => progress.observe(head);
    reportProgress = () => progress.summarize(run.core.head);
    rejectedRows = () => run.core.hasRejected();
    ensure(input.trigger !== "recovery" || run.recovery, "Recovery must not start a fresh extraction");
    await tasks.heartbeat();
    const saved = await run.core.state();
    await tasks.progress(
      run.recovery
        ? "Refreshing submitted Reverse ETL delivery status"
        : mirror
        ? "Extracting warehouse snapshot; no audience changes submitted yet"
        : "Starting Reverse ETL extraction and delivery"
    );
    await progress.log(
      `${
        run.recovery ? "Continuing saved delivery; warehouse SQL is not re-read. " : ""
      }Delivery counts describe API records, not matched people or targetable audience size. Submission is not acceptance; destination audience sizes may update separately.`
    );
    await progress.observe(run.core.head, true);
    const context: ReverseEtlContext<JsonObject, JsonObject> = {
      ...run.scope,
      mode: config.options.mode,
      fullRefresh: !config.model.cursor,
      credentials: adapter.credentials,
      options: adapter.options ?? (config.options.streamOptions as JsonObject),
      signal,
      store: createBufferedSyncStore(saved.store),
      delivery: run.delivery,
      // Provider messages can contain identifiers/tokens. Persist core-owned
      // lifecycle messages only until a structured redacted logging contract exists.
      log: { info() {}, warn() {}, debug() {}, error() {} },
      fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) }),
    };
    const source = async function* (after: CompositeCursor | undefined, sourceSignal: AbortSignal) {
      sourceSignal.throwIfAborted();
      reader = input.reader(config.warehouse);
      let rows = 0,
        deleted = 0,
        previouslySubmitted = 0,
        complete = false;
      try {
        for await (const row of reader.stream(config.model, after, sourceSignal)) {
          rows++;
          if (row.deleted) deleted++;
          const key = recordKey(config.model.primaryKey.map(column => row.row[column] as string | number | boolean));
          if (adapter.insertOnly && run.core.hasEventKey(key)) {
            previouslySubmitted++;
            continue;
          }
          yield {
            ...row,
            key,
          };
        }
        complete = true;
      } finally {
        if (adapter.insertOnly)
          await progress.log(
            `Event deduplication: ${rows} source rows, ${previouslySubmitted} previously submitted events omitted, ${
              rows - previouslySubmitted
            } new events.`
          );
        if (!mirror)
          await progress.log(
            `Source extraction ${complete ? "complete" : "interrupted"}: ${rows} rows read in this attempt, ${
              rows - deleted
            } upsert rows, ${deleted} explicit removal rows. Source rows are not confirmed deliveries.`
          );
      }
    };
    const hooks = adapter.recovery?.(saved.providerState);
    let result: string;
    if (mirror) {
      const targetBaseline = await adapter.verifyMirrorBaseline!(signal);
      const options = {
        persistence: run as Awaited<ReturnType<typeof openMirrorPersistence>>,
        adapter: adapter.mirror!,
        context,
        targetBaseline,
      };
      const phase = (await run.core.recoveryStatus()).phase;
      const rejected = run.recovery && (await run.core.hasRejected());
      if (run.recovery && phase !== "abort_prepared" && !rejected && (await run.snapshots.status())?.sealed) {
        // Local finish recovery needs no provider hooks; attachment is fail-closed.
        result = (
          await resumeSnapshotMirror(
            options,
            hooks ?? {
              attachWriter: async () => {
                throw new Error("Provider reconciliation required");
              },
            }
          )
        ).delivery;
      } else if (run.recovery)
        result = await recoverRun(run, context, hooks, adapter.mirror!.batchDelivery === "asynchronous");
      else
        result = (
          await runSnapshotMirror({
            ...options,
            mapping: config.options.mapping,
            source: sig => source(undefined, sig),
            onSnapshotProgress: progress =>
              tasks.progress(
                progress.sealed
                  ? `Snapshot complete: ${progress.sourceRows} source rows, ${progress.projectedMembers} projected audience members, ${progress.uniqueMembers} unique audience members, ${progress.duplicatesCollapsed} duplicates collapsed. Comparing audience membership and submitting changes.`
                  : `Extracted ${progress.sourceRows} source rows into snapshot; no audience changes submitted yet`
              ),
          })
        ).delivery;
    } else if (run.recovery)
      result = await recoverRun(run, context, hooks, adapter.stream.batchDelivery === "asynchronous");
    else
      result = (
        await runReverseEtl({
          stream: { ...adapter.stream, batchSize: Math.min(adapter.stream.batchSize, db.limits.batchRecords) },
          context,
          mapping: config.options.mapping,
          sourceKeyField: adapter.insertOnly ? "__sourceKey" : undefined,
          source,
          checkpointEvery: config.options.checkpointEvery,
        })
      ).delivery;
    // A committed delivery cannot be polled again; subsequent bookkeeping errors
    // must not restore PENDING against a terminal persistence control.
    deliveryFinished = result !== "pending";
    // Stop renewal before terminal task status; never let a late heartbeat read
    // our own SUCCESS as cancellation. Still hold the Kubernetes lease until finally.
    stopped = true;
    clearTimeout(timer);
    await renewing;
    signal.throwIfAborted();
    await reportProgress();
    if (result === "pending") {
      // Interrupted legacy runs remain recoverable but cannot admit overlapping extraction.
      await run.core.detach();
      return await tasks.wait(logicalRunId, config.configRevision);
    }
    const success = result === "accepted";
    const changed = await tasks.finish(
      success ? "COMPLETE" : "FAILED",
      success ? "Reverse ETL delivery committed" : "Recovery completed cleanup; next run will restart extraction"
    );
    return changed && success ? "COMPLETE" : "FAILED";
  } catch (error) {
    reportFailure(stage, error);
    stopped = true;
    clearTimeout(timer);
    await renewing;
    const status = signal.aborted && !ownershipLost ? "CANCELLED" : "FAILED";
    await reportProgress?.();
    // A final provider result is delivery evidence, not a failed status lookup.
    // Retain its binding for explicit continuation, but stop automatic polling.
    if (started && requiresManualReconciliation(error)) {
      await tasks.finish(status, failureMessage(error, tasks.taskId)).catch(() => undefined);
      return status;
    }
    if (started && refreshRunId && !deliveryFinished && !progress.deliveryChanged) {
      return await tasks.refreshFailed(
        `Status refresh failed without updating delivery outcomes. ${failureMessage(error, tasks.taskId)}`,
        error instanceof PersistenceResetRequiredError
      );
    }
    if (
      started &&
      refreshRunId &&
      !deliveryFinished &&
      !signal.aborted &&
      !ownershipLost &&
      !(error instanceof PersistenceResetRequiredError) &&
      !(await rejectedRows?.().catch(() => true))
    ) {
      // Polling errors do not discard a submitted run or create a new task. A
      // permanent row rejection still fails immediately; the polling deadline remains bounded.
      const result = await tasks.wait(refreshRunId, input.config.configRevision);
      await tasks.logError(`Status refresh could not complete. ${failureMessage(error, tasks.taskId)}`);
      return result;
    }
    if (started)
      await tasks
        .finish(
          status,
          ownershipLost
            ? "The worker lost ownership or could not report progress. Contact support or your Jitsu administrator; do not reset sync state."
            : signal.aborted
            ? "Reverse ETL cancelled; unresolved delivery retained"
            : error instanceof MirrorRunError || error instanceof PersistenceResetRequiredError
            ? error.message
            : failureMessage(error, input.taskId)
        )
        .catch(() => undefined);
    return status;
  } finally {
    stopped = true;
    clearTimeout(timer);
    await renewing;
    await reader?.close().catch(() => undefined);
    if (held) await lease.release().catch(() => undefined);
  }
}
