import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { Client, type PoolConfig } from "pg";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  BatchResult,
  JsonObject,
  ReverseEtlContext,
  ReverseEtlWriter,
  WriteBatch,
} from "@jitsu/protocols/reverse-etl";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { Database, prune } from "./persistence";
import { decodeJson, encodeJson } from "./persistence/serialization";
import {
  openMirrorPersistence,
  runSnapshotMirror,
  resumeSnapshotMirror,
  type NewMirrorOptions,
  type MirrorSourceRecord,
  type SnapshotMirrorAdapter,
} from "./mirror";

let container: StartedTestContainer;
let admin: Client;
let db: Database;
let runtimeConfig: PoolConfig;
type Session = Awaited<ReturnType<typeof openMirrorPersistence>>;
type SourceRow = { id: string; value: string };
const record = (key: string, id = key, value = "v"): MirrorSourceRecord => ({
  key: contentHash(key),
  row: { id, value },
});
const member = (id: string) => contentHash(id.toLowerCase());
const accepted = (batch: WriteBatch<JsonObject>): BatchResult => ({
  outcomes: batch.records.map(row => ({ operationId: row.operationId, status: "accepted" })),
});

beforeAll(async () => {
  container = await new GenericContainer("postgres:18-alpine")
    .withEnvironment({ POSTGRES_PASSWORD: "test", POSTGRES_DB: "mirror_test" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const config = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: "mirror_test",
    user: "postgres",
    password: "test",
  };
  admin = new Client(config);
  await admin.connect();
  const url = `postgresql://postgres:test@${config.host}:${config.port}/${config.database}?schema=newjitsu`;
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve("prisma/build/index.js"),
      "db",
      "push",
      `--schema=${fileURLToPath(new URL("../../../webapps/console/prisma/schema.prisma", import.meta.url))}`,
      "--skip-generate",
    ],
    {
      // eslint-disable-next-line no-restricted-properties -- disposable test database only.
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    }
  );
  await admin.query(
    "CREATE ROLE mirror_runtime LOGIN PASSWORD 'runtime'; GRANT USAGE ON SCHEMA newjitsu TO mirror_runtime"
  );
  for (const table of [
    "control",
    "target_owner",
    "batch",
    "operation",
    "generation",
    "source_key",
    "desired",
    "membership",
  ])
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON newjitsu.reverse_sync_${table} TO mirror_runtime`);
  await admin.query("GRANT SELECT,INSERT,UPDATE,DELETE ON newjitsu.source_state TO mirror_runtime");
  runtimeConfig = { ...config, user: "mirror_runtime", password: "runtime" };
  db = new Database(runtimeConfig);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await admin?.end();
  await container?.stop();
});
beforeEach(async () => {
  await admin.query(
    "TRUNCATE newjitsu.reverse_sync_operation,newjitsu.reverse_sync_batch,newjitsu.reverse_sync_control,newjitsu.reverse_sync_target_owner,newjitsu.reverse_sync_generation,newjitsu.reverse_sync_source_key,newjitsu.reverse_sync_desired,newjitsu.reverse_sync_membership,newjitsu.source_state"
  );
});
async function session(id = "run", taskId = id, database = db) {
  return openMirrorPersistence(database, {
    workspaceId: "workspace",
    syncId: "sync",
    logicalRunId: id,
    taskId,
    configRevision: "revision",
    targetIdentity: "test/account/audience",
    mode: "mirror",
    extraction: "full",
  });
}
async function takeover(run: Session) {
  return session(run.scope.logicalRunId, "recovery");
}
async function phase() {
  return (await admin.query("SELECT phase FROM newjitsu.reverse_sync_control")).rows[0].phase;
}
async function membership() {
  return (
    await admin.query("SELECT identity_hash,value FROM newjitsu.reverse_sync_membership ORDER BY identity_hash")
  ).rows.map(row => decodeJson<any>(row.value).upsert);
}

function fixture() {
  const calls: string[] = [];
  const requests: { action: string; batch: WriteBatch<JsonObject> }[] = [];
  const remote = new Map<string, JsonObject>();
  const receipts = new Map<string, BatchResult>();
  let projections = 0;
  let onBatch: ((action: string, batch: WriteBatch<JsonObject>) => Promise<BatchResult>) | undefined;
  let afterBatch: (() => void | Promise<void>) | undefined;
  let finishResult: "accepted" | "pending" | "throw" = "accepted";
  const controller = new AbortController();
  const writer = (ctx: ReverseEtlContext<{}, {}>): ReverseEtlWriter<JsonObject> => {
    expect(ctx).not.toHaveProperty("snapshots");
    expect(ctx).not.toHaveProperty("core");
    expect(ctx).not.toHaveProperty("db");
    const send = async (action: string, batch: WriteBatch<JsonObject>) => {
      calls.push(action);
      requests.push({ action, batch: JSON.parse(JSON.stringify(batch)) });
      for (const row of batch.records) expect(row.row).not.toHaveProperty("identityHash");
      const result = onBatch ? await onBatch(action, batch) : accepted(batch);
      receipts.set(batch.batchId, result);
      for (const outcome of result.outcomes)
        if (outcome.status === "accepted") {
          const row = batch.records.find(row => row.operationId === outcome.operationId)!.row;
          if (action === "upsert") remote.set(row.member as string, row);
          else remote.delete(row.member as string);
        }
      ctx.store.set("lastBatch", batch.batchId);
      await afterBatch?.();
      return result;
    };
    return {
      init: async () => {
        calls.push("init");
        await ctx.delivery.saveProviderState({ session: "remote-session" });
      },
      upsert: batch => send("upsert", batch),
      remove: batch => send("remove", batch),
      finish: async () => {
        calls.push("finish");
        if (finishResult === "throw") throw new Error("private-provider-token");
        return finishResult === "pending" ? { delivery: "pending", remoteJobIds: ["job"] } : { delivery: "accepted" };
      },
      abort: async () => {
        calls.push("abort");
      },
    };
  };
  const adapter: SnapshotMirrorAdapter<{}, SourceRow, {}> = {
    batchDelivery: "accepted",
    projection: {
      rowType: z.object({ id: z.string(), value: z.string() }),
      project: row => {
        projections++;
        const identity = member(row.id);
        return [{ identity, upsert: { member: identity, value: row.value }, remove: { member: identity } }];
      },
    },
    stream: {
      name: "test",
      displayName: "Test",
      rowType: z.object({ member: z.string(), value: z.string() }).strict(),
      removeRowType: z.object({ member: z.string() }).strict(),
      options: z.object({}),
      batchSize: 2,
      capabilities: {
        supportsUpsert: true,
        supportsExplicitRemove: true,
        mirror: "snapshot-diff",
        replay: "idempotent-operation",
      },
      createWriter: async ctx => {
        calls.push("create");
        return writer(ctx);
      },
    },
  };
  const options = (run: Session, rows: MirrorSourceRecord[]): NewMirrorOptions<{}, SourceRow, {}> => ({
    persistence: run,
    adapter,
    targetBaseline: "tracked",
    mapping: { id: "id", value: "value" },
    sourcePageSize: 2,
    context: { credentials: {}, options: {}, signal: controller.signal, log: {} as any, fetch: fetch as any },
    source: async function* () {
      calls.push("source");
      yield* rows;
    },
  });
  const recovery = {
    attachWriter: async (ctx: ReverseEtlContext<{}, {}>) => {
      calls.push("attach");
      return writer(ctx);
    },
    reconcileBatch: async (
      batch: WriteBatch<JsonObject>,
      _action: string,
      _saved: BatchResult | undefined,
      ctx: ReverseEtlContext<{}, {}>
    ) => {
      calls.push("reconcile");
      ctx.store.set("reconciled", true);
      return receipts.get(batch.batchId)!;
    },
    reconcileFinish: async (_saved: unknown, ctx: ReverseEtlContext<{}, {}>) => {
      calls.push("reconcileFinish");
      ctx.store.set("final", true);
      return { delivery: "accepted" as const };
    },
  };
  return {
    adapter,
    options,
    recovery,
    calls,
    requests,
    remote,
    receipts,
    controller,
    projections: () => projections,
    setBatch: (fn: typeof onBatch) => {
      onBatch = fn;
    },
    setAfterBatch: (fn: typeof afterBatch) => {
      afterBatch = fn;
    },
    setFinish: (value: typeof finishResult) => {
      finishResult = value;
    },
  };
}

describe("core snapshot mirror lifecycle", () => {
  it("collects all input before bounded writes and final promotion", async () => {
    const f = fixture(),
      run = await session();
    expect(await runSnapshotMirror(f.options(run, [record("a"), record("b"), record("c")]))).toEqual({
      delivery: "accepted",
      sourceSequence: 3,
    });
    expect(f.calls).toEqual(["create", "init", "source", "upsert", "upsert", "finish"]);
    expect(f.requests.map(r => r.batch.records.length)).toEqual([2, 1]);
    expect(f.projections()).toBe(3);
    expect(await membership()).toHaveLength(3);
    expect(await phase()).toBe("complete");
    expect(
      (await admin.query("SELECT committed_generation FROM newjitsu.reverse_sync_control")).rows[0].committed_generation
    ).toBe("run");
  });
  it("handles unchanged, shared and changed identities across generations without rehashing", async () => {
    const f = fixture(),
      first = await session();
    await runSnapshotMirror(f.options(first, [record("key1", "Shared"), record("key2", "SHARED"), record("old")]));
    expect(f.requests.flatMap(r => r.batch.records.map(row => row.row.member)).sort()).toEqual(
      [member("shared"), member("old")].sort()
    );
    const second = await session("second");
    f.calls.length = 0;
    f.requests.length = 0;
    await runSnapshotMirror(f.options(second, [record("key2", "shared"), record("old", "new")]));
    expect(f.requests.map(r => [r.action, r.batch.records.map(row => row.row.member)])).toEqual([
      ["upsert", [member("new")]],
      ["remove", [member("old")]],
    ]);
    expect(await membership()).toHaveLength(2);
    const third = await session("third");
    await prune(db, third.scope, new Date(Date.now() - 30 * 86400000));
    f.requests.length = 0;
    await runSnapshotMirror(f.options(third, []));
    expect(f.requests.map(r => r.action)).toEqual(["remove"]);
    expect(await membership()).toEqual([]);
    expect(f.remote.size).toBe(0);
  });
  it("finishes empty and unchanged snapshots explicitly without synthetic batches", async () => {
    const f = fixture(),
      first = await session();
    await runSnapshotMirror(f.options(first, []));
    expect(f.calls).toEqual(["create", "init", "source", "finish"]);
    const second = await session("second");
    await runSnapshotMirror(f.options(second, [record("a")]));
    const third = await session("third");
    await prune(db, third.scope, new Date(Date.now() - 30 * 86400000));
    f.calls.length = 0;
    f.requests.length = 0;
    expect(await runSnapshotMirror(f.options(third, [record("a")]))).toEqual({
      delivery: "accepted",
      sourceSequence: 0,
    });
    expect(f.calls).toEqual(["create", "init", "source", "finish"]);
    expect(f.requests).toEqual([]);
  });
  it.each(["invalid", "duplicate", "conflict", "source-throw"])(
    "suppresses all delivery for late %s source failure",
    async failure => {
      const f = fixture(),
        run = await session();
      const rows = [
        record("a"),
        record("b"),
        failure === "duplicate"
          ? record("a")
          : failure === "conflict"
          ? record("c", "a", "different")
          : { key: contentHash("c"), row: { id: 42, value: "v" } },
      ];
      const input = f.options(run, rows);
      if (failure === "source-throw")
        input.source = async function* () {
          yield record("a");
          throw new Error("private-source-data");
        };
      await expect(runSnapshotMirror(input)).rejects.toThrow("Snapshot mirror stopped");
      expect(f.requests).toEqual([]);
      expect(f.calls.at(-1)).toBe("abort");
      expect(await phase()).toBe("aborted");
      expect(await membership()).toEqual([]);
    }
  );
  it.each(["staged", "rejected"] as const)(
    "persists %s results before suppressing removal and promotion",
    async status => {
      const f = fixture(),
        first = await session();
      await runSnapshotMirror(f.options(first, [record("old")]));
      const run = await session("next");
      f.calls.length = 0;
      f.setBatch((_action, batch) =>
        Promise.resolve({
          outcomes: batch.records.map((row, i) =>
            i === 0
              ? { operationId: row.operationId, status: "accepted" }
              : status === "staged"
              ? { operationId: row.operationId, status }
              : { operationId: row.operationId, status, code: "invalid", safeReason: "Invalid row" }
          ),
        })
      );
      await expect(runSnapshotMirror(f.options(run, [record("a"), record("b")]))).rejects.toThrow();
      expect(f.calls).not.toContain("remove");
      expect(f.calls).not.toContain("finish");
      expect(f.calls.at(-1)).toBe("abort");
      expect(await membership()).toHaveLength(2);
      expect(
        (await admin.query("SELECT committed_generation FROM newjitsu.reverse_sync_control")).rows[0]
          .committed_generation
      ).toBe("run");
    }
  );
  it("removes accepted failed-run additions on the next successful full snapshot", async () => {
    const f = fixture(),
      first = await session();
    f.setBatch((_action, batch) =>
      Promise.resolve({
        outcomes: batch.records.map((row, i) =>
          i
            ? { operationId: row.operationId, status: "rejected", code: "invalid", safeReason: "Invalid" }
            : { operationId: row.operationId, status: "accepted" }
        ),
      })
    );
    await expect(runSnapshotMirror(f.options(first, [record("a"), record("b")]))).rejects.toThrow();
    expect(await membership()).toHaveLength(1);
    const next = await session("next");
    await prune(db, next.scope, new Date(Date.now() - 30 * 86400000));
    f.setBatch(undefined);
    await runSnapshotMirror(f.options(next, []));
    expect(await membership()).toEqual([]);
    expect(f.remote.size).toBe(0);
  });
  it("reconciles an ambiguous batch from its exact stored payload without source replay", async () => {
    const f = fixture(),
      run = await session();
    f.setAfterBatch(() => {
      throw new Error("private-remote-response");
    });
    await expect(runSnapshotMirror(f.options(run, [record("a"), record("b"), record("c")]))).rejects.toThrow();
    expect(await phase()).toBe("running");
    expect(f.calls).not.toContain("abort");
    expect(await membership()).toEqual([]);
    const recovered = await takeover(run);
    f.setAfterBatch(undefined);
    const before = f.projections();
    f.calls.length = 0;
    const options = f.options(recovered, [record("changed-query")]);
    expect(await resumeSnapshotMirror(options, f.recovery)).toEqual({ delivery: "accepted", sourceSequence: 3 });
    expect(f.calls).toEqual(["reconcile", "attach", "upsert", "finish"]);
    expect(f.projections()).toBe(before);
    expect(await membership()).toHaveLength(3);
    expect((await recovered.core.state()).store).toMatchObject({ reconciled: true });
    expect(f.requests[0].batch.records[0].row.member).toMatch(/^[a-f0-9]{64}$/);
  });
  it("keeps unknown work blocked without reconciliation and rejects non-recovery sessions", async () => {
    const f = fixture(),
      run = await session();
    f.setAfterBatch(() => {
      throw new Error("lost response");
    });
    await expect(runSnapshotMirror(f.options(run, [record("a")]))).rejects.toThrow();
    const recovered = await takeover(run);
    const before = f.calls.length;
    await expect(
      resumeSnapshotMirror(f.options(recovered, []), { attachWriter: f.recovery.attachWriter })
    ).rejects.toThrow();
    await expect(resumeSnapshotMirror(f.options(run, []), f.recovery)).rejects.toThrow();
    expect(f.calls).toHaveLength(before);
    expect(await phase()).toBe("running");
  });
  it.each(["pending", "throw"] as const)(
    "reconciles %s finalization without a second finish or writer initialization",
    async outcome => {
      const f = fixture(),
        run = await session();
      f.setFinish(outcome);
      if (outcome === "pending")
        expect((await runSnapshotMirror(f.options(run, [record("a")]))).delivery).toBe("pending");
      else await expect(runSnapshotMirror(f.options(run, [record("a")]))).rejects.toThrow();
      expect(f.calls).not.toContain("abort");
      const recovered = await takeover(run);
      f.calls.length = 0;
      expect(await resumeSnapshotMirror(f.options(recovered, []), f.recovery)).toEqual({
        delivery: "accepted",
        sourceSequence: 1,
      });
      expect(f.calls).toEqual(["reconcileFinish"]);
      expect((await recovered.core.state()).store.final).toBe(true);
      expect(await phase()).toBe("complete");
    }
  );
  it("retries local final-state promotion without repeating accepted finalization", async () => {
    const f = fixture(),
      run = await session();
    await admin.query(
      "ALTER TABLE newjitsu.source_state ADD CONSTRAINT injected_commit_failure CHECK (false) NOT VALID"
    );
    try {
      await expect(runSnapshotMirror(f.options(run, [record("a")]))).rejects.toThrow();
    } finally {
      await admin.query("ALTER TABLE newjitsu.source_state DROP CONSTRAINT injected_commit_failure");
    }
    expect(await phase()).toBe("finish_accepted");
    expect(f.calls).not.toContain("abort");
    expect(
      (await admin.query("SELECT committed_generation FROM newjitsu.reverse_sync_control")).rows[0].committed_generation
    ).toBeNull();
    const recovered = await takeover(run);
    f.calls.length = 0;
    await resumeSnapshotMirror(f.options(recovered, []), f.recovery);
    expect(f.calls).toEqual([]);
    expect(await phase()).toBe("complete");
  });
  it("stops cancellation after acceptance before any removals", async () => {
    const f = fixture(),
      first = await session();
    await runSnapshotMirror(f.options(first, [record("old")]));
    const next = await session("next");
    f.calls.length = 0;
    f.setAfterBatch(() => {
      f.controller.abort();
    });
    await expect(runSnapshotMirror(f.options(next, [record("new")]))).rejects.toThrow();
    expect(f.calls).not.toContain("remove");
    expect(f.calls).not.toContain("finish");
    expect(await membership()).toHaveLength(2);
  });
  it("rejects unsupported adapter capabilities before provider calls", async () => {
    const f = fixture(),
      run = await session();
    f.adapter.batchDelivery = "finish" as any;
    await expect(runSnapshotMirror(f.options(run, []))).rejects.toThrow(/per-batch/);
    expect(f.calls).toEqual([]);
  });
  it("splits provider requests by exact manifest bytes", async () => {
    const f = fixture(),
      run = await session();
    f.adapter.stream.batchSize = 100;
    const input = f.options(
      run,
      Array.from({ length: 5 }, (_, i) => record(String(i), String(i), "x".repeat(400)))
    );
    input.maxBatchBytes = 1400;
    await runSnapshotMirror(input);
    expect(f.requests).toHaveLength(5);
    for (const request of f.requests) expect(Buffer.byteLength(JSON.stringify(request.batch))).toBeLessThan(1400);
  });
  it("stops on a rejected removal while retaining accepted removal progress", async () => {
    const f = fixture(),
      first = await session();
    await runSnapshotMirror(f.options(first, [record("a"), record("b"), record("c")]));
    const next = await session("next");
    f.calls.length = 0;
    f.setBatch((_action, batch) =>
      Promise.resolve({
        outcomes: batch.records.map((row, i) =>
          i
            ? { operationId: row.operationId, status: "rejected", code: "invalid", safeReason: "Rejected removal" }
            : { operationId: row.operationId, status: "accepted" }
        ),
      })
    );
    await expect(runSnapshotMirror(f.options(next, []))).rejects.toThrow();
    expect(f.calls.filter(call => call === "remove")).toHaveLength(1);
    expect(f.calls).not.toContain("finish");
    expect(await membership()).toHaveLength(2);
    expect(
      (await admin.query("SELECT committed_generation FROM newjitsu.reverse_sync_control")).rows[0].committed_generation
    ).toBe("run");
  });
  it("reconciles an ambiguous removal without recreating the writer or replaying the remove", async () => {
    const f = fixture(),
      first = await session();
    await runSnapshotMirror(f.options(first, [record("a")]));
    const next = await session("next");
    f.setAfterBatch(() => {
      throw new Error("lost removal response");
    });
    await expect(runSnapshotMirror(f.options(next, []))).rejects.toThrow();
    expect(await membership()).toHaveLength(1);
    const recovered = await takeover(next);
    f.setAfterBatch(undefined);
    f.calls.length = 0;
    await resumeSnapshotMirror(f.options(recovered, []), f.recovery);
    expect(f.calls).toEqual(["reconcile", "attach", "finish"]);
    expect(await membership()).toEqual([]);
  });
  it("does not reopen incomplete input during recovery", async () => {
    const f = fixture(),
      first = await session();
    await first.delivery.prepareInit({});
    await first.delivery.acknowledgeInit({});
    await first.snapshots.start();
    const recovered = await takeover(first);
    await expect(resumeSnapshotMirror(f.options(recovered, [record("changed")]), f.recovery)).rejects.toThrow();
    expect(f.calls).toEqual([]);
    expect(await phase()).toBe("running");
  });
  it("does not initialize a writer after cancellation during construction", async () => {
    const f = fixture(),
      run = await session();
    const createWriter = f.adapter.stream.createWriter;
    f.adapter.stream.createWriter = async ctx => {
      const writer = await createWriter(ctx);
      f.controller.abort();
      return writer;
    };
    await expect(runSnapshotMirror(f.options(run, [record("a")]))).rejects.toThrow();
    expect(f.controller.signal.aborted).toBe(true);
    expect(f.calls).toEqual(["create"]);
    expect(await phase()).toBe("init_prepared");
    expect(await membership()).toEqual([]);
  });
  it("does not construct a writer or open a source after cancellation", async () => {
    const f = fixture(),
      run = await session();
    f.controller.abort();
    await expect(runSnapshotMirror(f.options(run, []))).rejects.toThrow();
    expect(f.calls).toEqual([]);
    expect(await phase()).toBe("new");
  });
  it("enforces snapshot storage limits before any delivery", async () => {
    const limited = new Database(runtimeConfig, { limits: { snapshotEntries: 1 } });
    try {
      const f = fixture(),
        run = await session("run", "run", limited);
      await expect(runSnapshotMirror(f.options(run, [record("a"), record("b")]))).rejects.toThrow();
      expect(f.requests).toEqual([]);
      expect(await phase()).toBe("aborted");
    } finally {
      await limited.close();
    }
  });
  // Optional index/pagination scale check; deliberately seeds SQL rows rather than exercising million-row provider calls.
  // eslint-disable-next-line no-restricted-properties -- opt-in test workload, not application configuration.
  it.skipIf(process.env.RETL_MIRROR_SCALE_TEST !== "1")(
    "bounds diff pages with one million desired identities",
    async () => {
      const run = await session();
      await run.delivery.prepareInit({});
      await run.delivery.acknowledgeInit({});
      await run.snapshots.start();
      await admin.query(`INSERT INTO newjitsu.reverse_sync_desired (workspace_id,sync_id,generation,identity_hash,payload_hash,value)
      SELECT 'workspace','sync','run',lpad(to_hex(n),64,'0'),'unchanged',decode('00','hex') FROM generate_series(1,999999) AS n`);
      await admin.query(`INSERT INTO newjitsu.reverse_sync_membership (workspace_id,sync_id,identity_hash,payload_hash,value)
      SELECT workspace_id,sync_id,identity_hash,payload_hash,value FROM newjitsu.reverse_sync_desired`);
      const f = fixture();
      const desired = f.adapter.projection.project({ id: "last", value: "v" })[0];
      const effect = {
        ...desired,
        identityHash: contentHash(desired.identity),
        payloadHash: contentHash(desired.upsert),
      };
      const encoded = encodeJson(effect, 10000);
      await admin.query(
        "INSERT INTO newjitsu.reverse_sync_desired (workspace_id,sync_id,generation,identity_hash,payload_hash,value) VALUES ('workspace','sync','run',$1,$2,$3)",
        [effect.identityHash, effect.payloadHash, encoded]
      );
      await admin.query("ANALYZE newjitsu.reverse_sync_desired; ANALYZE newjitsu.reverse_sync_membership");
      await run.snapshots.seal();
      expect(await run.snapshots.page("additions", "", 2)).toEqual([effect]);
      expect(await run.snapshots.page("additions", effect.identityHash, 2)).toEqual([]);
      expect(Number((await admin.query("SELECT count(*) AS n FROM newjitsu.reverse_sync_desired")).rows[0].n)).toBe(
        1_000_000
      );
    },
    120_000
  );
});
