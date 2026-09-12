import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  BatchResult,
  DeliveryJournal,
  ReverseEtlContext,
  ReverseEtlStream,
  ReverseEtlWriter,
  WriteBatch,
} from "@jitsu/protocols/reverse-etl";
import {
  createReverseEtlRegistry,
  createBufferedSyncStore,
  contentHash,
  recordKey,
  runReverseEtl,
} from "../src/reverse-etl";
import { validateBatchResult, validateFinishResult, validateReverseEtlConfig } from "../src/reverse-etl/meta";

type Row = { email: string };
const rowType = z.object({ email: z.string().email() }).strict();
function fixture(count = 3) {
  const calls: string[] = [];
  const controller = new AbortController();
  const batches: WriteBatch<Row>[] = [];
  const accept = async (batch: WriteBatch<Row>): Promise<BatchResult> => {
    calls.push("write");
    batches.push(batch);
    return { outcomes: batch.records.map(row => ({ operationId: row.operationId, status: "accepted" })) };
  };
  const writer: ReverseEtlWriter<Row> = {
    init: vi.fn(async () => {
      calls.push("init");
    }),
    upsert: vi.fn(accept),
    remove: vi.fn(accept),
    finish: vi.fn(async () => {
      calls.push("finish");
      return { delivery: "accepted" };
    }),
    abort: vi.fn(async () => {
      calls.push("abort");
    }),
  };
  const journal: DeliveryJournal = {
    prepareAbort: vi.fn(async () => {
      calls.push("prepare-abort");
    }),
    acknowledgeAbort: vi.fn(async () => {
      calls.push("ack-abort");
    }),
    assertReady: vi.fn(async () => {
      calls.push("ready");
      return { sourceSequence: 0 };
    }),
    prepareInit: vi.fn(async () => {
      calls.push("prepare-init");
    }),
    acknowledgeInit: vi.fn(async () => {
      calls.push("ack-init");
    }),
    prepare: vi.fn(async () => {
      calls.push("prepare");
    }),
    acknowledge: vi.fn(async () => {
      calls.push("ack");
    }),
    markUnknown: vi.fn(async () => {
      calls.push("unknown");
    }),
    saveProviderState: vi.fn(async () => {}),
    prepareFinish: vi.fn(async () => {
      calls.push("prepare-finish");
    }),
    acknowledgeFinish: vi.fn(async () => {
      calls.push("ack-finish");
    }),
    commitCheckpoint: vi.fn(async (_, __, complete) => {
      calls.push(complete ? "complete" : "checkpoint");
    }),
  };
  const ctx: ReverseEtlContext<{}, {}> = {
    syncId: "sync",
    taskId: "task",
    logicalRunId: "logical-run",
    configRevision: "revision",
    fencingEpoch: "1",
    targetIdentity: "provider:account:audience",
    mode: "upsert",
    fullRefresh: false,
    credentials: {},
    options: {},
    signal: controller.signal,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    fetch: vi.fn(),
    store: createBufferedSyncStore(),
    delivery: journal,
  };
  const stream: ReverseEtlStream<{}, Row, {}> = {
    name: "audience",
    displayName: "Audience",
    rowType,
    removeRowType: rowType,
    options: z.object({}).strict(),
    batchSize: 2,
    capabilities: {
      supportsUpsert: true,
      supportsExplicitRemove: true,
      mirror: "none",
      replay: "idempotent-operation",
    },
    createWriter: vi.fn(async () => writer),
  };
  const rows = Array.from({ length: count }, (_, i) => ({
    key: recordKey([i]),
    row: { address: `member${i}@example.com` },
    deleted: false,
    checkpoint: { value: String(i), primaryKeyValues: [String(i)] },
  }));
  const source = vi.fn(async function* () {
    calls.push("source");
    yield* rows;
  });
  const run = () => runReverseEtl({ stream, context: ctx, mapping: { email: "address" }, source, checkpointEvery: 2 });
  return { run, rows, calls, writer, journal, ctx, stream, source, controller, batches };
}

describe("Reverse ETL lifecycle", () => {
  it("creates writers without exposing a snapshot persistence service", async () => {
    const f = fixture(0);
    await f.run();
    const context = vi.mocked(f.stream.createWriter).mock.calls[0][0];
    expect(context).not.toHaveProperty("snapshot");
    // This is only the bounded provider KV serialization, not audience snapshots.
    expect(context.store.snapshot()).toEqual({});
  });
  it("bounds resumed cursor state even when the next source is empty", async () => {
    const f = fixture(0);
    vi.mocked(f.journal.assertReady).mockResolvedValue({
      sourceSequence: 1,
      cursor: { value: "x".repeat(65537), primaryKeyValues: ["1"] },
    });
    await expect(f.run()).rejects.toThrow(/byte limit/);
    expect(f.writer.init).not.toHaveBeenCalled();
    expect(f.journal.commitCheckpoint).not.toHaveBeenCalled();
  });
  it("counts keys, IDs and cursor bytes in the prepared batch bound", async () => {
    const f = fixture(4);
    f.stream.batchSize = 100;
    await runReverseEtl({
      stream: f.stream,
      context: f.ctx,
      source: f.source,
      mapping: { email: "address" },
      checkpointEvery: 100,
      maxBatchBytes: 700,
    });
    expect(f.journal.prepare).toHaveBeenCalledTimes(2);
    for (const [batch] of vi.mocked(f.journal.prepare).mock.calls)
      expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(700);
  });
  it("rejects oversized cursor values and non-hashed source keys before sending", async () => {
    const f = fixture(1);
    f.rows[0].checkpoint.value = "x".repeat(1000001);
    await expect(f.run()).rejects.toThrow(/byte limit/);
    expect(f.writer.upsert).not.toHaveBeenCalled();
    const g = fixture(1);
    g.rows[0].key = "x".repeat(1000001);
    await expect(g.run()).rejects.toThrow(/envelope/);
    expect(g.writer.upsert).not.toHaveBeenCalled();
  });
  it("a source row larger than the bound never reaches the writer", async () => {
    const f = fixture(1);
    await expect(
      runReverseEtl({
        stream: f.stream,
        context: f.ctx,
        source: f.source,
        mapping: { email: "address" },
        checkpointEvery: 2,
        maxBatchBytes: 10,
      })
    ).rejects.toThrow(/byte limit/);
    expect(f.writer.upsert).not.toHaveBeenCalled();
  });
  it("failed init remains prepared and does not open the source", async () => {
    const f = fixture();
    vi.mocked(f.writer.init).mockRejectedValue(new Error("private API body"));
    await expect(f.run()).rejects.toThrow("Reverse ETL run failed; inspect acknowledged recovery state");
    expect(f.journal.prepareInit).toHaveBeenCalled();
    expect(f.journal.acknowledgeInit).not.toHaveBeenCalled();
    expect(f.source).not.toHaveBeenCalled();
  });
  it("uncertain finish remains prepared without a second finalization attempt", async () => {
    const f = fixture(1);
    vi.mocked(f.writer.finish).mockRejectedValue(new Error("timeout"));
    await expect(f.run()).rejects.toThrow();
    expect(f.journal.prepareFinish).toHaveBeenCalled();
    expect(f.writer.finish).toHaveBeenCalledTimes(1);
    expect(f.journal.acknowledgeFinish).not.toHaveBeenCalled();
    expect(f.journal.commitCheckpoint).not.toHaveBeenCalled();
  });
  it("validates options before recovery admission or provider work", async () => {
    const f = fixture();
    f.ctx.options = { invalid: true };
    await expect(f.run()).rejects.toThrow(/options/);
    expect(f.journal.assertReady).not.toHaveBeenCalled();
  });
  it("cannot resume a cursorless query by sequence alone", async () => {
    const f = fixture();
    vi.mocked(f.journal.assertReady).mockResolvedValue({ sourceSequence: 2 });
    await expect(f.run()).rejects.toThrow(/sequence alone/);
    expect(f.source).not.toHaveBeenCalled();
  });
  it("prepares and acknowledges before checkpointing, then explicitly finishes", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ delivery: "accepted", sourceSequence: 3 });
    expect(f.calls).toEqual([
      "ready",
      "prepare-init",
      "init",
      "ack-init",
      "source",
      "prepare",
      "write",
      "ack",
      "checkpoint",
      "prepare",
      "write",
      "ack",
      "prepare-finish",
      "finish",
      "ack-finish",
      "complete",
    ]);
    expect(f.batches.map(b => b.records.length)).toEqual([2, 1]);
    expect(f.batches[0].records[0]).toMatchObject({
      key: f.rows[0].key,
      sourceSequence: 1,
      row: { email: "member0@example.com" },
    });
    expect(f.writer.abort).not.toHaveBeenCalled();
  });
  it("an empty source still finishes exactly once and never sends an empty remove", async () => {
    const f = fixture(0);
    await f.run();
    expect(f.writer.finish).toHaveBeenCalledTimes(1);
    expect(f.writer.upsert).not.toHaveBeenCalled();
    expect(f.writer.remove).not.toHaveBeenCalled();
    expect(f.journal.prepareFinish).toHaveBeenCalledWith(0, {});
  });
  it("keeps staged deletes ahead of later accepted upserts without advancing the watermark", async () => {
    const f = fixture(4);
    f.rows[0].deleted = true;
    vi.mocked(f.writer.remove!).mockImplementation(async batch => ({
      outcomes: batch.records.map(r => ({ operationId: r.operationId, status: "staged" })),
    }));
    await f.run();
    expect(f.writer.remove).toHaveBeenCalledTimes(1);
    expect(f.journal.commitCheckpoint).toHaveBeenCalledTimes(1);
    expect(f.journal.commitCheckpoint).toHaveBeenLastCalledWith(
      { sourceSequence: 4, cursor: f.rows[3].checkpoint },
      {},
      true
    );
    expect(f.calls.indexOf("ack-finish")).toBeLessThan(f.calls.indexOf("complete"));
  });
  it("pending finish remains recoverable without completion or abort", async () => {
    const f = fixture();
    vi.mocked(f.writer.upsert).mockImplementation(async batch => ({
      outcomes: batch.records.map(r => ({ operationId: r.operationId, status: "staged" })),
    }));
    vi.mocked(f.writer.finish).mockResolvedValue({ delivery: "pending", remoteJobIds: ["job-1"] });
    expect((await f.run()).delivery).toBe("pending");
    expect(f.journal.acknowledgeFinish).toHaveBeenCalledWith({ delivery: "pending", remoteJobIds: ["job-1"] }, {});
    expect(f.journal.commitCheckpoint).not.toHaveBeenCalled();
    expect(f.writer.abort).not.toHaveBeenCalled();
  });
  it("permanent rejection acknowledges accepted siblings and stops immediately", async () => {
    const f = fixture(6);
    vi.mocked(f.writer.upsert).mockImplementation(async batch => ({
      outcomes: batch.records.map((r, i) =>
        i
          ? { operationId: r.operationId, status: "rejected", code: "bad", safeReason: "Invalid" }
          : { operationId: r.operationId, status: "accepted" }
      ),
    }));
    await expect(f.run()).rejects.toThrow(/rejected a row/);
    expect(f.writer.upsert).toHaveBeenCalledTimes(1);
    expect(f.journal.acknowledge).toHaveBeenCalledTimes(1);
    expect(f.journal.commitCheckpoint).not.toHaveBeenCalled();
    expect(f.writer.finish).not.toHaveBeenCalled();
    expect(f.writer.abort).toHaveBeenCalledWith("error");
  });
  it("source validation fails before flushing an earlier buffer and hides source values", async () => {
    const f = fixture();
    f.rows[1].row.address = "private-bad-email";
    await expect(f.run()).rejects.toThrow("Source row failed destination validation");
    expect(f.writer.upsert).not.toHaveBeenCalled();
    expect(f.writer.finish).not.toHaveBeenCalled();
  });
  it("uncertain delivery is journaled without a blind retry", async () => {
    const f = fixture();
    vi.mocked(f.writer.upsert).mockRejectedValue(new Error("secret provider token"));
    await expect(f.run()).rejects.toThrow(/uncertain/);
    expect(f.journal.markUnknown).toHaveBeenCalledTimes(1);
    expect(f.writer.upsert).toHaveBeenCalledTimes(1);
    expect(f.journal.commitCheckpoint).not.toHaveBeenCalled();
  });
  it("a malformed acknowledgement cannot advance checkpoints", async () => {
    const f = fixture();
    vi.mocked(f.writer.upsert).mockResolvedValue({ outcomes: [] });
    await expect(f.run()).rejects.toThrow(/uncertain/);
    expect(f.journal.acknowledge).not.toHaveBeenCalled();
    expect(f.journal.markUnknown).toHaveBeenCalled();
  });
  it("cancellation during a provider call persists the response before abort", async () => {
    const f = fixture();
    vi.mocked(f.writer.upsert).mockImplementation(async batch => {
      f.controller.abort();
      return { outcomes: batch.records.map(r => ({ operationId: r.operationId, status: "accepted" })) };
    });
    await expect(f.run()).rejects.toThrow(/cancelled/);
    expect(f.journal.acknowledge).toHaveBeenCalled();
    expect(f.journal.commitCheckpoint).not.toHaveBeenCalled();
    expect(f.writer.abort).toHaveBeenCalledWith("cancelled");
  });
  it("losing the fence before prepare prevents the remote call", async () => {
    const f = fixture();
    vi.mocked(f.journal.prepare).mockRejectedValue(new Error("stale fence"));
    vi.mocked(f.journal.prepareAbort).mockRejectedValue(new Error("stale fence"));
    await expect(f.run()).rejects.toThrow();
    expect(f.writer.upsert).not.toHaveBeenCalled();
    expect(f.writer.finish).not.toHaveBeenCalled();
    expect(f.writer.abort).not.toHaveBeenCalled();
    expect(f.journal.acknowledgeAbort).not.toHaveBeenCalled();
  });
  it("acknowledgement failure preserves the prepared manifest and never checkpoints", async () => {
    const f = fixture();
    vi.mocked(f.journal.acknowledge).mockRejectedValue(new Error("DB unavailable"));
    await expect(f.run()).rejects.toThrow();
    expect(f.journal.prepare).toHaveBeenCalled();
    expect(f.journal.commitCheckpoint).not.toHaveBeenCalled();
  });
  it("unfinished recovery blocks init and extraction", async () => {
    const f = fixture();
    vi.mocked(f.journal.assertReady).mockRejectedValue(new Error("Recovery required"));
    await expect(f.run()).rejects.toThrow();
    expect(f.source).not.toHaveBeenCalled();
    expect(f.writer.init).not.toHaveBeenCalled();
  });
  it("init is prepared and abort failure never masks a source validation error", async () => {
    const f = fixture();
    f.rows[0].row.address = "bad";
    vi.mocked(f.writer.abort).mockRejectedValue(new Error("secret cleanup failure"));
    await expect(f.run()).rejects.toThrow("Source row failed destination validation");
    expect(f.calls.indexOf("prepare-init")).toBeLessThan(f.calls.indexOf("init"));
  });
  it("resume passes the lossless cursor to extraction and continues sequence numbers", async () => {
    const f = fixture(1);
    const cursor = { value: "9007199254740993", primaryKeyValues: ["a"] };
    vi.mocked(f.journal.assertReady).mockResolvedValue({ sourceSequence: 20, cursor });
    await f.run();
    expect(f.source).toHaveBeenCalledWith(cursor, f.controller.signal);
    expect(f.batches[0].records[0].sourceSequence).toBe(21);
  });
  it("stable operation IDs survive task retries but change for new logical runs", async () => {
    const a = fixture(1),
      b = fixture(1),
      c = fixture(1);
    b.ctx.taskId = "retry-task";
    b.ctx.fencingEpoch = "2";
    c.ctx.logicalRunId = "new-run";
    await a.run();
    await b.run();
    await c.run();
    expect(a.batches[0].records[0].operationId).toBe(b.batches[0].records[0].operationId);
    expect(a.batches[0].records[0].operationId).not.toBe(c.batches[0].records[0].operationId);
  });
  it("refuses mirror until snapshot recovery is implemented", async () => {
    const f = fixture();
    f.ctx.mode = "mirror";
    await expect(f.run()).rejects.toThrow(/Mirror execution/);
    expect(f.source).not.toHaveBeenCalled();
  });
  it("a cursorless model only checkpoints on complete delivery", async () => {
    const f = fixture(4);
    f.rows.forEach(row => {
      delete (row as any).checkpoint;
    });
    await f.run();
    expect(f.journal.commitCheckpoint).toHaveBeenCalledTimes(1);
    expect(f.journal.commitCheckpoint).toHaveBeenLastCalledWith({ sourceSequence: 4, cursor: undefined }, {}, true);
  });
});

describe("contracts and metadata", () => {
  it("rejects non-JSON or oversized provider checkpoints", () => {
    expect(() => validateFinishResult({ delivery: "accepted", providerCheckpoint: { progress: NaN } })).toThrow();
    expect(() =>
      validateFinishResult({ delivery: "accepted", providerCheckpoint: { progress: "a".repeat(65537) } })
    ).toThrow();
  });
  const batch = {
    batchId: "batch",
    records: ["a", "b"].map(operationId => ({ operationId, key: operationId, sourceSequence: 1, row: {} })),
  };
  it.each([
    [{ operationId: "a", status: "accepted" }],
    [
      { operationId: "a", status: "accepted" },
      { operationId: "a", status: "accepted" },
    ],
    [
      { operationId: "a", status: "accepted" },
      { operationId: "foreign", status: "accepted" },
    ],
    [
      { operationId: "a", status: "unknown" },
      { operationId: "b", status: "accepted" },
    ],
  ])("rejects incomplete/duplicate/foreign/unknown outcomes", (...outcomes) => {
    expect(() => validateBatchResult(batch, { outcomes })).toThrow();
  });
  it("requires remote IDs for pending finish", () =>
    expect(() => validateFinishResult({ delivery: "pending" })).toThrow());
  it("validates projected mappings, options and independent mirror/remove capabilities", () => {
    const f = fixture();
    const input = { mode: "upsert" as const, mapping: { email: "address" }, columns: ["address"], options: {} };
    expect(validateReverseEtlConfig(f.stream, input)).toEqual({});
    expect(() => validateReverseEtlConfig(f.stream, { ...input, mapping: { unknown: "address" } })).toThrow();
    expect(() => validateReverseEtlConfig(f.stream, { ...input, columns: [] })).toThrow();
    expect(() => validateReverseEtlConfig(f.stream, { ...input, options: { unknown: true } })).toThrow();
    f.stream.capabilities.mirror = "native-replace";
    f.stream.capabilities.supportsExplicitRemove = false;
    expect(() => validateReverseEtlConfig(f.stream, { ...input, mode: "mirror" })).not.toThrow();
    expect(() => validateReverseEtlConfig(f.stream, { ...input, deleteColumn: "deleted" })).toThrow();
    expect(() => validateReverseEtlConfig(f.stream, { ...input, mode: "mirror", cursor: {} })).toThrow();
  });
  it("keeps reverse registrations separate and validates defaults", () => {
    const f = fixture();
    const destination = { credentials: z.object({}), streams: [f.stream], defaultStream: "audience" };
    const registry = createReverseEtlRegistry({ "builtin.reverse.example": destination });
    expect(registry.get("builtin.reverse.example")).toBe(destination);
    expect(registry.get("builtin.destination.example")).toBeUndefined();
    expect(() =>
      createReverseEtlRegistry({ "builtin.reverse.example": { ...destination, defaultStream: "missing" } })
    ).toThrow();
  });
});

describe("canonical identity and bounded provider store", () => {
  it("hashes canonical objects, preserves typed keys and rejects lossy values", () => {
    expect(contentHash({ b: 1, a: 2 })).toBe(contentHash({ a: 2, b: 1 }));
    expect(recordKey([1])).not.toBe(recordKey(["1"]));
    expect(() => recordKey([Number.MAX_SAFE_INTEGER + 1])).toThrow();
    expect(() => contentHash({ missing: undefined })).toThrow();
    expect(() => contentHash(NaN)).toThrow();
    expect(() => contentHash(Array(1))).toThrow();
  });
  it("copies state, preserves prototype-like keys and rejects oversized writes atomically", () => {
    const store = createBufferedSyncStore({}, 100);
    const value = { nested: "old" };
    store.set("__proto__", value);
    value.nested = "changed";
    expect(store.get("__proto__")).toEqual({ nested: "old" });
    expect(() => store.set("huge", "a".repeat(100))).toThrow();
    expect(store.get("huge")).toBeUndefined();
    const snapshot = store.snapshot();
    snapshot.extra = true;
    expect(store.get("extra")).toBeUndefined();
  });
});
