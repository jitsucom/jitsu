import { randomUUID } from "node:crypto";
import type { JsonObject, ReverseEtlContext } from "@jitsu/protocols/reverse-etl";
import type { WarehouseReader, CompositeCursor } from "@jitsu/warehouse-query";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { createBufferedSyncStore, recordKey } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { runReverseEtl } from "@jitsu/destination-functions/src/reverse-etl/run";
import { Database, openPersistence } from "./persistence";
import type { ControlRow } from "./persistence/rows";
import { ensure, PersistenceResetRequiredError } from "./persistence/types";
import { openMirrorPersistence, runSnapshotMirror, resumeSnapshotMirror, MirrorRunError } from "./mirror";
import type { AdapterRegistry } from "./adapters";
import type { RunLease } from "./lease";
import { Tasks, type TaskResult } from "./tasks";
import { recoverRun } from "./recovery";
import { reportFailure, type FailureStage } from "./diagnostics";

export interface ExecuteOptions {
  config: ReverseRunConfig;
  taskId: string;
  trigger: "manual" | "scheduled" | "recovery";
  recoveryOf?: string;
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
  const tasks = new Tasks(db, input.config.id, input.taskId, input.config.workspaceId);
  let reader: WarehouseReader | undefined;
  let started = false;
  let held = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewing: Promise<void> | undefined;
  let stopped = false;
  let ownershipLost = false;
  let stage: FailureStage = "lease_acquire";
  const signal = controller.signal;
  const tick = async () => {
    try {
      await lease.renew();
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
    await tasks.start(input.trigger, input.recoveryOf, input.config.configRevision);
    started = true;
    stage = "admission";
    const config = ReverseRunConfig.parse(await input.admit());
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
    const adapter = bind(config);
    ensure(adapter.stream.name === config.options.stream, "Reverse stream does not match adapter");
    if (config.options.mode === "mirror")
      ensure(
        adapter.mirror && adapter.mirror.stream === adapter.stream && adapter.verifyMirrorBaseline,
        "Mirror adapter not verified"
      );
    const logicalRunId = await db.transaction(async client => {
      const result = await client.query<Pick<ControlRow, "run_id" | "phase">>(
        "SELECT run_id,phase FROM reverse_sync_control WHERE workspace_id=$1 AND sync_id=$2",
        [config.workspaceId, config.id]
      );
      const previous = result.rows[0];
      return previous && !["complete", "aborted"].includes(previous.phase) ? previous.run_id : randomUUID();
    });
    // Recheck the Kubernetes lease before opening persistence. Durable state still
    // rejects changed revision/target/mode, but does not authorize worker ownership.
    await lease.renew();
    signal.throwIfAborted();
    const runInput = {
      workspaceId: config.workspaceId,
      syncId: config.id,
      taskId: input.taskId,
      logicalRunId,
      targetIdentity: adapter.targetIdentity,
      configRevision: config.configRevision,
      mode: config.options.mode,
      extraction: config.model.cursor ? ("cursor" as const) : ("full" as const),
    };
    const mirror = config.options.mode === "mirror";
    // Restoring large object-backed baselines must not outlive worker ownership.
    timer = setTimeout(() => {
      renewing = tick();
    }, input.heartbeatMs ?? 10_000);
    const run = mirror
      ? await openMirrorPersistence(db, runInput)
      : await openPersistence(db, runInput, adapter.project);
    const scope = run.scope;
    ensure(input.trigger !== "recovery" || run.recovery, "Recovery must not start a fresh extraction");
    await tasks.heartbeat();
    const saved = await run.core.state();
    await tasks.progress(
      run.recovery
        ? "Reconciling interrupted Reverse ETL delivery"
        : mirror
        ? "Extracting warehouse snapshot; no audience changes submitted yet"
        : "Starting Reverse ETL extraction and delivery"
    );
    const context: ReverseEtlContext<JsonObject, JsonObject> = {
      ...run.scope,
      mode: config.options.mode,
      fullRefresh: !config.model.cursor,
      credentials: adapter.credentials,
      options: config.options.streamOptions as JsonObject,
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
      for await (const row of reader.stream(config.model, after, sourceSignal)) {
        yield {
          ...row,
          key: recordKey(config.model.primaryKey.map(column => row.row[column] as string | number | boolean)),
        };
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
            onSnapshotProgress: (rows, sealed) =>
              tasks.progress(
                sealed
                  ? `Snapshot complete: ${rows} source rows. Comparing audience membership and submitting changes.`
                  : `Extracted ${rows} source rows into snapshot; no audience changes submitted yet`
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
          source,
          checkpointEvery: config.options.checkpointEvery,
        })
      ).delivery;
    // Stop renewal before terminal task status; never let a late heartbeat read
    // our own SUCCESS as cancellation. Still hold the Kubernetes lease until finally.
    stopped = true;
    clearTimeout(timer);
    await renewing;
    signal.throwIfAborted();
    if (result === "pending") return await tasks.wait(logicalRunId, config.configRevision);
    const success = result === "accepted";
    const changed = await tasks.finish(
      success ? "SUCCESS" : "FAILED",
      success ? "Reverse ETL delivery committed" : "Recovery completed cleanup; next run will restart extraction"
    );
    return changed && success ? "SUCCESS" : "FAILED";
  } catch (error) {
    reportFailure(stage, error);
    stopped = true;
    clearTimeout(timer);
    await renewing;
    const status = signal.aborted && !ownershipLost ? "CANCELLED" : "FAILED";
    if (started)
      await tasks
        .finish(
          status,
          ownershipLost
            ? "Reverse ETL ownership or task heartbeat lost; recovery required"
            : signal.aborted
            ? "Reverse ETL cancelled; unresolved delivery retained"
            : error instanceof MirrorRunError || error instanceof PersistenceResetRequiredError
            ? error.message
            : "Reverse ETL failed; inspect configuration and durable recovery state"
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
