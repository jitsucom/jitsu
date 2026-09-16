import type { ZodType } from "zod";
import type {
  BatchResult,
  FinishResult,
  JsonObject,
  PreparedBatch,
  ReverseEtlContext,
  ReverseEtlStream,
  ReverseEtlWriter,
  WriteBatch,
} from "@jitsu/protocols/reverse-etl";
import {
  canonicalJson,
  contentHash,
  createBufferedSyncStore,
} from "@jitsu/destination-functions/src/reverse-etl/identity";
import {
  validateBatchResult,
  validateFinishResult,
  validateStream,
} from "@jitsu/destination-functions/src/reverse-etl/meta";
import { Database, openPersistence, type Effect, type Identity, type RunInput } from "./persistence";
import { effects } from "./persistence/snapshots";
import { ensure, PersistenceError } from "./persistence/types";

/** Pure, deterministic normalization, invoked once per source row, never during delivery/recovery. */
export interface MirrorProjection<Row> {
  rowType: ZodType<Row>;
  /** [] deliberately excludes a valid source row; invalid input/projection must throw, never return []. */
  project(row: Row): Identity[];
}
export interface SnapshotMirrorAdapter<Credentials, Row, Options> {
  stream: ReverseEtlStream<Credentials, JsonObject, Options>;
  projection: MirrorProjection<Row>;
  /** Snapshot-diff cannot remove safely when additions require finish() to become accepted. */
  batchDelivery: "accepted";
}

function projectedEnvelope(row: unknown): Effect {
  const value = row as Effect;
  const projected = effects([value])[0];
  ensure(canonicalJson(projected) === canonicalJson(value), "Invalid persisted mirror effect");
  return projected;
}
const mirrorSession = Symbol("mirror-persistence");

/** Bind the journal to already-normalized Effect envelopes, not an adapter that might hash twice. */
export async function openMirrorPersistence(db: Database, input: RunInput) {
  ensure(input.mode === "mirror" && input.extraction === "full", "Snapshot mirror requires full extraction");
  const run = await openPersistence(db, input, (_, row) => {
    const { identity, upsert, remove } = projectedEnvelope(row);
    return [{ identity, upsert, remove }];
  });
  return { ...run, [mirrorSession]: true as const };
}
type MirrorPersistence = Awaited<ReturnType<typeof openMirrorPersistence>>;
type MirrorContext<C, O> = Pick<ReverseEtlContext<C, O>, "credentials" | "options" | "signal" | "log" | "fetch">;
export interface MirrorOptions<C, Row, O> {
  persistence: MirrorPersistence;
  adapter: SnapshotMirrorAdapter<C, Row, O>;
  context: MirrorContext<C, O>;
  /** Caller must verify a new empty audience or an exclusively tracked/imported complete baseline. */
  targetBaseline: "new-empty" | "tracked";
  maxBatchBytes?: number;
}
export interface MirrorSourceRecord {
  key: string;
  row: Record<string, unknown>;
}
export interface NewMirrorOptions<C, Row, O> extends MirrorOptions<C, Row, O> {
  mapping: Record<string, string>;
  /** A complete cursorless source. Opens only after Kubernetes admission and writer initialization. */
  source(signal: AbortSignal): AsyncIterable<MirrorSourceRecord>;
  sourcePageSize?: number;
}
export interface MirrorRecovery<C, O> {
  /** Reattach the verified existing session using the recovered context/store; never blindly create a second session. */
  attachWriter(context: ReverseEtlContext<C, O>): Promise<ReverseEtlWriter<JsonObject>>;
  /** Verify outcomes or perform a provider-proven safe replay of this exact persisted request. */
  reconcileBatch?(
    batch: WriteBatch<JsonObject>,
    action: "upsert" | "remove",
    saved: BatchResult | undefined,
    context: ReverseEtlContext<C, O>
  ): Promise<BatchResult>;
  reconcileFinish?(saved: FinishResult | undefined, context: ReverseEtlContext<C, O>): Promise<FinishResult>;
}

/** Convert a journal manifest to the exact provider-ready request, without normalization. */
export function mirrorDeliveryBatch(batch: PreparedBatch<unknown>): WriteBatch<JsonObject> {
  return {
    batchId: batch.batchId,
    records: batch.records.map(record => {
      const effect = projectedEnvelope(record.row);
      return { ...record, row: batch.action === "upsert" ? effect.upsert : effect.remove };
    }),
  };
}

async function setup<C, Row, O>(input: MirrorOptions<C, Row, O>) {
  const {
    persistence: run,
    adapter: { stream },
    context,
  } = input;
  ensure(run[mirrorSession], "Use mirror-bound persistence for snapshot delivery");
  ensure(run.scope.mode === "mirror" && run.scope.extraction === "full", "Snapshot mirror requires full extraction");
  ensure(["new-empty", "tracked"].includes(input.targetBaseline), "Verified target baseline is required");
  validateStream(stream);
  ensure(
    input.adapter.batchDelivery === "accepted" &&
      stream.capabilities.mirror === "snapshot-diff" &&
      stream.capabilities.supportsUpsert &&
      stream.capabilities.supportsExplicitRemove &&
      stream.removeRowType,
    "Snapshot diff requires per-batch acceptance and explicit removal"
  );
  const options = stream.options.safeParse(context.options);
  ensure(options.success, "Invalid mirror options");
  const maxBytes = input.maxBatchBytes ?? 1_000_000;
  ensure(
    Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= run.core.db.limits.batchBytes,
    "Invalid mirror batch byte limit"
  );
  const store = createBufferedSyncStore((await run.core.state()).store);
  const ctx: ReverseEtlContext<C, O> = {
    ...context,
    ...run.scope,
    mode: "mirror",
    fullRefresh: true,
    options: options.data,
    store,
    delivery: run.delivery,
  };
  return { run, stream, ctx, maxBytes, batchSize: Math.min(stream.batchSize, run.core.db.limits.batchRecords) };
}

function validatePayloads(effect: Effect, stream: ReverseEtlStream<any, JsonObject, any>) {
  for (const [schema, value] of [
    [stream.rowType, effect.upsert],
    [stream.removeRowType!, effect.remove],
  ] as const) {
    const result = schema.safeParse(value);
    ensure(result.success && canonicalJson(result.data) === canonicalJson(value), "Invalid projected mirror payload");
  }
}
function validateWriter(writer: ReverseEtlWriter<JsonObject>) {
  ensure(
    typeof writer.init === "function" &&
      typeof writer.upsert === "function" &&
      typeof writer.remove === "function" &&
      typeof writer.finish === "function" &&
      typeof writer.abort === "function",
    "Incomplete snapshot mirror writer"
  );
}
function requireAccepted(result: BatchResult) {
  ensure(!result.outcomes.some(outcome => outcome.status === "rejected"), "Destination rejected a row; mirror stopped");
  ensure(
    result.outcomes.every(outcome => outcome.status === "accepted"),
    "Staged mirror batches require reconciliation before planning"
  );
}
function safeError(): PersistenceError {
  return new PersistenceError("Snapshot mirror stopped; inspect durable recovery state before retrying");
}

/** New snapshot-diff lifecycle. No executable service, scheduling, native replacement or billing. */
export async function runSnapshotMirror<C, Row, O>(input: NewMirrorOptions<C, Row, O>) {
  const env = await setup(input);
  const { run, stream, ctx } = env;
  const pageSize = input.sourcePageSize ?? Math.min(1000, run.core.db.limits.batchRecords);
  ensure(
    Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= run.core.db.limits.batchRecords,
    "Invalid snapshot source page size"
  );
  ensure(
    Object.keys(input.mapping).length > 0 &&
      Object.values(input.mapping).every(v => typeof v === "string" && v.length > 0),
    "Invalid mirror mapping"
  );
  let writer: ReverseEtlWriter<JsonObject> | undefined;
  let uncertain = false;
  try {
    ctx.signal.throwIfAborted();
    await run.delivery.assertReady();
    await run.snapshots.start();
    await run.delivery.prepareInit(ctx.store.snapshot());
    ctx.signal.throwIfAborted();
    uncertain = true;
    writer = await stream.createWriter(ctx);
    validateWriter(writer);
    await run.core.recoveryStatus();
    ctx.signal.throwIfAborted();
    await writer.init();
    await run.delivery.acknowledgeInit(ctx.store.snapshot());
    uncertain = false;
    let page: { key: string; identities: Identity[] }[] = [];
    let pageBytes = 2;
    let sequence = 0;
    const flush = async () => {
      if (!page.length) return;
      ctx.signal.throwIfAborted();
      await run.snapshots.append(page, ++sequence);
      page = [];
      pageBytes = 2;
    };
    ctx.signal.throwIfAborted();
    for await (const record of input.source(ctx.signal)) {
      ctx.signal.throwIfAborted();
      ensure(/^[a-f0-9]{64}$/.test(record.key), "Invalid mirror source key");
      const mapped = Object.fromEntries(
        Object.entries(input.mapping).map(([field, column]) => [field, record.row[column]])
      );
      const parsed = input.adapter.projection.rowType.safeParse(mapped);
      ensure(parsed.success, "Source row failed mirror validation");
      const projected = effects(input.adapter.projection.project(parsed.data), { allowEmpty: true });
      for (const value of projected) validatePayloads(value, stream);
      const serialized = canonicalJson({
        key: record.key,
        identities: projected.map(({ identity, upsert, remove }) => ({ identity, upsert, remove })),
      });
      const row: { key: string; identities: Identity[] } = JSON.parse(serialized);
      const bytes = Buffer.byteLength(serialized);
      ensure(bytes + 2 <= run.core.db.limits.batchBytes, "Snapshot source row exceeds byte budget");
      if (page.length && (page.length === pageSize || pageBytes + bytes + 1 > run.core.db.limits.batchBytes))
        await flush();
      pageBytes += bytes + (page.length ? 1 : 0);
      page.push(row);
    }
    await flush();
    ctx.signal.throwIfAborted();
    await run.snapshots.seal();
    return await deliver(env, writer, value => {
      uncertain = value;
    });
  } catch {
    if (writer && !uncertain) {
      try {
        await run.delivery.prepareAbort();
        await writer.abort(ctx.signal.aborted ? "cancelled" : "error");
        await run.delivery.acknowledgeAbort();
      } catch {
        /* Preserve original failure and all unresolved evidence. */
      }
    }
    throw safeError();
  }
}

/** Resume only sealed input using its persisted payloads and an explicitly reattached writer. */
export async function resumeSnapshotMirror<C, Row, O>(input: MirrorOptions<C, Row, O>, recovery: MirrorRecovery<C, O>) {
  const env = await setup(input);
  const { run, ctx } = env;
  try {
    ctx.signal.throwIfAborted();
    ensure(run.recovery, "Mirror resume requires a recovery session");
    const status = await run.core.recoveryStatus();
    ensure((await run.snapshots.status())?.sealed, "Incomplete source requires reconciled abort and a new full run");
    if (
      ["finish_prepared", "finish_pending", "finish_resolving", "finish_accepted", "complete"].includes(status.phase)
    ) {
      if (["finish_prepared", "finish_pending"].includes(status.phase)) {
        ensure(recovery.reconcileFinish, "Finalization requires provider reconciliation");
        const result = validateFinishResult(await recovery.reconcileFinish(status.finish, ctx));
        await run.core.acknowledgeRecoveredFinish(result, ctx.store.snapshot());
        if (result.delivery === "pending") return { delivery: "pending" as const, sourceSequence: status.nextSequence };
      } else if (status.phase === "finish_resolving") {
        await run.core.acknowledgeRecoveredFinish({ delivery: "accepted" }, ctx.store.snapshot());
      }
      if (status.phase !== "complete")
        await run.delivery.commitCheckpoint({ sourceSequence: status.nextSequence }, ctx.store.snapshot(), true);
      return { delivery: "accepted" as const, sourceSequence: status.nextSequence };
    }
    ensure(status.phase === "running", "Recover provider initialization before mirror delivery");
    let after = "";
    for (;;) {
      const page = await run.core.recoveryPage(after);
      if (!page.length) break;
      for (const entry of page) {
        ctx.signal.throwIfAborted();
        const saved = await run.core.recoveryBatch(entry.batchId);
        ensure(!saved.operations.some(op => op.status === "rejected"), "Rejected rows prohibit mirror continuation");
        if (saved.operations.some(op => op.status !== "accepted")) {
          ensure(recovery.reconcileBatch, "Uncertain batch requires provider reconciliation");
          const result = validateBatchResult(
            saved.batch,
            await recovery.reconcileBatch(mirrorDeliveryBatch(saved.batch), saved.batch.action, saved.result, ctx)
          );
          await run.core.acknowledgeRecovered(entry.batchId, result, ctx.store.snapshot());
          requireAccepted(result);
        }
        after = entry.batchId;
      }
    }
    ctx.signal.throwIfAborted();
    // Recheck lifecycle state after callbacks and before authorizing provider-session attachment.
    await run.core.recoveryStatus();
    const writer = await recovery.attachWriter(ctx);
    validateWriter(writer);
    return await deliver(env, writer, () => {}, true);
  } catch {
    throw safeError();
  }
}

async function deliver<C, Row, O>(
  env: Awaited<ReturnType<typeof setup<C, Row, O>>>,
  writer: ReverseEtlWriter<JsonObject>,
  uncertain: (value: boolean) => void,
  recovered = false
) {
  const { run, stream, ctx, maxBytes, batchSize } = env;
  let sequence = (await run.core.recoveryStatus()).nextSequence;
  for (const kind of ["additions", "removals"] as const) {
    const action = kind === "additions" ? "upsert" : "remove";
    let after = "";
    for (;;) {
      ctx.signal.throwIfAborted();
      const page = await run.snapshots.page(kind, after, Math.min(batchSize, 1000));
      if (!page.length) break;
      let records: PreparedBatch<Effect>["records"] = [];
      const prepared = (): PreparedBatch<Effect> => ({
        batchId: contentHash([run.scope.logicalRunId, action, records.map(row => row.operationId)]),
        action,
        records,
        payloadHash: contentHash(records.map(row => row.row)),
      });
      const flush = async () => {
        if (!records.length) return;
        ctx.signal.throwIfAborted();
        const batch = prepared();
        await run.delivery.prepare(batch, ctx.store.snapshot());
        // From prepare onward even a lost DB response / cancelled request belongs to recovery.
        uncertain(true);
        ctx.signal.throwIfAborted();
        let result: BatchResult;
        try {
          const wire = mirrorDeliveryBatch(batch);
          result = validateBatchResult(
            batch,
            action === "upsert" ? await writer.upsert(wire) : await writer.remove!(wire)
          );
        } catch {
          await run.delivery.markUnknown(batch.batchId);
          throw safeError();
        }
        if (recovered) await run.core.acknowledgeRecovered(batch.batchId, result, ctx.store.snapshot());
        else await run.delivery.acknowledge(batch.batchId, result, ctx.store.snapshot());
        uncertain(false);
        requireAccepted(result);
        records = [];
      };
      for (const effect of page) {
        validatePayloads(effect, stream);
        const row = JSON.parse(canonicalJson(effect)) as Effect;
        const operationId = contentHash([
          run.scope.syncId,
          run.scope.logicalRunId,
          run.scope.configRevision,
          run.scope.targetIdentity,
          action,
          effect.identityHash,
          contentHash(row),
        ]);
        const record = { key: effect.identityHash, row, operationId, sourceSequence: sequence + 1 };
        records.push(record);
        if (Buffer.byteLength(canonicalJson(prepared())) > maxBytes) {
          records.pop();
          await flush();
          records.push(record);
          ensure(Buffer.byteLength(canonicalJson(prepared())) <= maxBytes, "Mirror operation exceeds batch byte limit");
        }
        sequence++;
        after = effect.identityHash;
      }
      await flush();
    }
  }
  ctx.signal.throwIfAborted();
  await run.delivery.prepareFinish(sequence, ctx.store.snapshot());
  uncertain(true);
  ctx.signal.throwIfAborted();
  const result = validateFinishResult(await writer.finish());
  if (recovered) await run.core.acknowledgeRecoveredFinish(result, ctx.store.snapshot());
  else await run.delivery.acknowledgeFinish(result, ctx.store.snapshot());
  if (result.delivery === "accepted")
    await run.delivery.commitCheckpoint({ sourceSequence: sequence }, ctx.store.snapshot(), true);
  return { delivery: result.delivery, sourceSequence: sequence };
}
