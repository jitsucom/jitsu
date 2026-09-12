import type {
  DeliveryJournal,
  PreparedBatch,
  ResumePoint,
  ReverseEtlContext,
  ReverseEtlStream,
  ReverseEtlWriter,
  SourceCursor,
  WriteBatch,
} from "@jitsu/protocols/reverse-etl";
import { canonicalJson, contentHash } from "./identity";
import { ReverseEtlProtocolError, validateBatchResult, validateFinishResult, validateStream } from "./meta";

export interface ReverseSourceRecord {
  key: string;
  row: Record<string, unknown>;
  deleted: boolean;
  checkpoint?: SourceCursor;
}
export interface RunOptions<Credentials, Row, Options> {
  stream: ReverseEtlStream<Credentials, Row, Options>;
  context: ReverseEtlContext<Credentials, Options>;
  mapping: Record<string, string>;
  /** Must open lazily, only after recovery admission. Readers enforce unique keys. */
  source: (after: SourceCursor | undefined, signal: AbortSignal) => AsyncIterable<ReverseSourceRecord>;
  checkpointEvery: number;
  maxBatchBytes?: number;
}

function copyCursor(cursor: SourceCursor | undefined): SourceCursor | undefined {
  if (cursor === undefined) return undefined;
  if (
    !cursor ||
    typeof cursor.value !== "string" ||
    !Array.isArray(cursor.primaryKeyValues) ||
    cursor.primaryKeyValues.length < 1 ||
    cursor.primaryKeyValues.length > 8 ||
    cursor.primaryKeyValues.some(value => typeof value !== "string")
  ) {
    throw new ReverseEtlProtocolError("Invalid source cursor");
  }
  const copied = { value: cursor.value, primaryKeyValues: [...cursor.primaryKeyValues] };
  if (Buffer.byteLength(canonicalJson(copied)) > 65536)
    throw new ReverseEtlProtocolError("Source cursor exceeds its byte limit");
  return copied;
}

/**
 * Upsert lifecycle core. No database driver, provider API, automatic retry or
 * scheduling here. The production caller MUST supply the fenced PostgreSQL-backed journal;
 * this module deliberately provides no memory-only journal fallback.
 *
 * Consecutive operations of the same kind share a batch; kind changes flush it.
 * Serial writes keep source order and bound memory even for finish-staged runs.
 */
export async function runReverseEtl<C, R, O>(
  input: RunOptions<C, R, O>
): Promise<{
  delivery: "accepted" | "pending";
  sourceSequence: number;
}> {
  const { stream, source, mapping, checkpointEvery } = input;
  const maxBatchBytes = input.maxBatchBytes ?? 1_000_000;
  validateStream(stream);
  const options = stream.options.safeParse(input.context.options);
  if (!options.success) throw new ReverseEtlProtocolError("Invalid reverse stream options");
  const ctx = { ...input.context, options: options.data };
  if (ctx.mode !== "upsert") throw new ReverseEtlProtocolError("Mirror execution is not enabled in this runner yet");
  if (
    !stream.capabilities.supportsUpsert ||
    !Number.isSafeInteger(checkpointEvery) ||
    checkpointEvery < 1 ||
    checkpointEvery > 1_000_000
  ) {
    throw new ReverseEtlProtocolError("Invalid upsert/checkpoint configuration");
  }
  if (
    !Number.isSafeInteger(maxBatchBytes) ||
    maxBatchBytes < 1 ||
    maxBatchBytes > 10_000_000 ||
    !Object.keys(mapping).length
  ) {
    throw new ReverseEtlProtocolError("Invalid batch byte limit or empty mapping");
  }
  ctx.signal.throwIfAborted();
  // Any uncertain remote work must be reconciled before opening a changed query
  // or creating a second provider session. assertReady is a fenced persistence gate.
  const resume = await ctx.delivery.assertReady().catch(() => {
    throw new ReverseEtlProtocolError("Recovery admission failed; reconcile outstanding work before running");
  });
  if (!Number.isSafeInteger(resume.sourceSequence) || resume.sourceSequence < 0)
    throw new ReverseEtlProtocolError("Invalid resume sequence");
  if (!ctx.fullRefresh && resume.sourceSequence > 0 && !resume.cursor)
    throw new ReverseEtlProtocolError("A full query must restart after recovery, not resume by sequence alone");
  let writer: ReverseEtlWriter<R> | undefined;
  // Full refresh starts a full scan after recovery, never from a saved cursor.
  let point: ResumePoint = ctx.fullRefresh
    ? { sourceSequence: 0 }
    : { sourceSequence: resume.sourceSequence, cursor: copyCursor(resume.cursor) };
  let batch: WriteBatch<R>["records"] = [];
  let action: "upsert" | "remove" = "upsert";
  let bytes = 0;
  let staged = false;
  let finishStarted = false;
  let sinceCheckpoint = 0;
  const store = () => ctx.store.snapshot();
  const journal: DeliveryJournal = ctx.delivery;

  async function flush() {
    if (!batch.length) return;
    ctx.signal.throwIfAborted();
    const prepared: PreparedBatch<R> = {
      batchId: contentHash([ctx.logicalRunId, action, batch.map(row => row.operationId)]),
      action,
      records: batch,
      payloadHash: contentHash(batch.map(row => row.row)),
      ...(point.cursor ? { cursor: point.cursor } : {}),
    };
    await journal.prepare(prepared, store());
    ctx.signal.throwIfAborted();
    let result;
    try {
      const raw = action === "upsert" ? await writer!.upsert(prepared) : await writer!.remove!(prepared);
      result = validateBatchResult(prepared, raw);
    } catch {
      // A malformed response/throw can follow successful provider acceptance.
      // Keep the prepared manifest; never retry an ambiguous call blindly.
      await journal.markUnknown(prepared.batchId);
      throw new ReverseEtlProtocolError("Batch delivery is uncertain; reconcile its journal before retrying");
    }
    // Persist known outcomes even if cancellation arrived during the request, or
    // one row was rejected. Only the journal records durable acceptance/billing.
    await journal.acknowledge(prepared.batchId, result, store());
    if (result.outcomes.some(outcome => outcome.status === "rejected")) {
      throw new ReverseEtlProtocolError("Destination rejected a row; the run stopped without skipping it");
    }
    staged ||= result.outcomes.some(outcome => outcome.status === "staged");
    batch = [];
    bytes = 0;
    ctx.signal.throwIfAborted();
  }

  try {
    ctx.signal.throwIfAborted();
    writer = await stream.createWriter(ctx);
    if (stream.capabilities.supportsExplicitRemove && !writer.remove)
      throw new ReverseEtlProtocolError("Writer is missing its declared remove method");
    if (stream.capabilities.replay === "reconcile-required" && !writer.reconcile)
      throw new ReverseEtlProtocolError("Writer requires a reconciliation method");
    await journal.prepareInit(store());
    ctx.signal.throwIfAborted();
    await writer.init();
    await journal.acknowledgeInit(store());
    ctx.signal.throwIfAborted();
    for await (const record of source(copyCursor(point.cursor), ctx.signal)) {
      ctx.signal.throwIfAborted();
      if (typeof record.key !== "string" || !/^[a-f0-9]{64}$/.test(record.key) || typeof record.deleted !== "boolean")
        throw new ReverseEtlProtocolError("Invalid source record envelope");
      const nextAction = record.deleted ? "remove" : "upsert";
      if (record.deleted && (!stream.capabilities.supportsExplicitRemove || !writer.remove)) {
        throw new ReverseEtlProtocolError("Stream does not support explicit remove");
      }
      const mapped = Object.fromEntries(
        Object.entries(mapping).map(([field, column]) => [
          field,
          Object.hasOwn(record.row, column) ? record.row[column] : undefined,
        ])
      );
      const row = (record.deleted ? stream.removeRowType! : stream.rowType).safeParse(mapped);
      // Do not emit schema issues: they can contain raw identifiers/source values.
      if (!row.success) throw new ReverseEtlProtocolError("Source row failed destination validation");
      const sequence = point.sourceSequence + 1;
      if (!Number.isSafeInteger(sequence)) throw new ReverseEtlProtocolError("Source sequence limit exceeded");
      const cursor = copyCursor(record.checkpoint);
      const operationId = contentHash([
        ctx.syncId,
        ctx.logicalRunId,
        ctx.configRevision,
        ctx.targetIdentity,
        nextAction,
        record.key,
        contentHash(row.data),
      ]);
      const entry = { key: record.key, sourceSequence: sequence, row: row.data, operationId };
      const size = Buffer.byteLength(canonicalJson(entry));
      // Exact serialized envelope cost (hashes have fixed length). Store state
      // has its own independent 64-KiB bound and is not hidden in this budget.
      const headerSize = Buffer.byteLength(
        canonicalJson({
          batchId: "0".repeat(64),
          action: nextAction,
          records: [],
          payloadHash: "0".repeat(64),
          ...(cursor ? { cursor } : {}),
        })
      );
      if (size + headerSize > maxBatchBytes)
        throw new ReverseEtlProtocolError("Source envelope exceeds the delivery byte limit");
      if (batch.length && (nextAction !== action || bytes + 1 + size + headerSize > maxBatchBytes)) await flush();
      action = nextAction;
      point = { sourceSequence: sequence, cursor };
      bytes += size + (batch.length ? 1 : 0);
      batch.push(entry);
      sinceCheckpoint++;
      if (batch.length >= stream.batchSize || sinceCheckpoint >= checkpointEvery) await flush();
      if (sinceCheckpoint >= checkpointEvery) {
        if (!ctx.fullRefresh && !staged && point.cursor) await journal.commitCheckpoint(point, store(), false);
        sinceCheckpoint = 0;
      }
    }
    await flush();
    ctx.signal.throwIfAborted();
    await journal.prepareFinish(point.sourceSequence, store());
    ctx.signal.throwIfAborted();
    // An uncertain finish remains a prepared manifest for recovery. Never call
    // finish twice, and never substitute an empty remove batch for finalization.
    finishStarted = true;
    const result = validateFinishResult(await writer.finish());
    await journal.acknowledgeFinish(result, store());
    if (result.delivery === "pending") return { delivery: "pending", sourceSequence: point.sourceSequence };
    ctx.signal.throwIfAborted();
    await journal.commitCheckpoint(point, store(), true);
    return { delivery: "accepted", sourceSequence: point.sourceSequence };
  } catch (error) {
    try {
      // Once finalization starts, even a timeout can mean remote acceptance.
      // Recovery must reconcile/commit it, not undo it through provider abort.
      if (writer && !finishStarted) {
        // A stale worker must not cancel/delete a session now owned by recovery.
        // Like writes, already-authorized in-flight cleanup remains reconcilable.
        await journal.prepareAbort();
        await writer.abort(ctx.signal.aborted ? "cancelled" : "error");
        await journal.acknowledgeAbort();
      }
    } catch {
      /* Original failure wins. */
    }
    // Library/transport errors may contain tokens or row data. Preserve only our
    // own deliberately redacted errors; never log/rethrow arbitrary SDK bodies.
    if (error instanceof ReverseEtlProtocolError) throw error;
    throw new ReverseEtlProtocolError(
      ctx.signal.aborted ? "Reverse ETL run cancelled" : "Reverse ETL run failed; inspect acknowledged recovery state"
    );
  }
}
