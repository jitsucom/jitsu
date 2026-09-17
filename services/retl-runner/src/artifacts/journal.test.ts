import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { Client } from "pg";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PreparedBatch, BatchResult } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { Database, openPersistence, type RunInput } from "../persistence";
import { openMirrorPersistence, runSnapshotMirror, resumeSnapshotMirror, type MirrorOptions } from "../mirror";
import { z } from "zod";
import type { JsonObject, ReverseEtlWriter } from "@jitsu/protocols/reverse-etl";
import { effects } from "../persistence/snapshots";
import { MemoryObjects } from "./test-support";
import type { ObjectJournal } from "./journal";

let container: StartedTestContainer, admin: Client, url: string, objects: MemoryObjects;
const databases: Database[] = [];
const input = (extra: Partial<RunInput> = {}): RunInput => ({
  workspaceId: "w",
  syncId: "s",
  taskId: "t",
  logicalRunId: "r",
  configRevision: "v",
  targetIdentity: "target",
  mode: "upsert",
  extraction: "full",
  ...extra,
});
const project = (_action: unknown, row: any) => [{ identity: row.id, upsert: row, remove: { id: row.id } }];
const database = () => {
  const db = new Database(
    { connectionString: url },
    { objectStorage: { store: objects, signal: new AbortController().signal } }
  );
  databases.push(db);
  return db;
};
const session = (scope = input()) => openPersistence(database(), scope, project);
type Session = Awaited<ReturnType<typeof session>>;
async function init(run: Session) {
  await run.delivery.assertReady();
  await run.delivery.prepareInit({});
  await run.delivery.acknowledgeInit({});
}
function batch(run: Session, ids: string[], start = 1, action: "upsert" | "remove" = "upsert"): PreparedBatch<any> {
  const records = ids.map((id, i) => {
    const row = { id },
      key = contentHash(id);
    return {
      key,
      row,
      sourceSequence: start + i,
      operationId: contentHash([
        run.scope.syncId,
        run.scope.logicalRunId,
        run.scope.configRevision,
        run.scope.targetIdentity,
        action,
        key,
        contentHash(row),
      ]),
    };
  });
  return {
    action,
    records,
    batchId: contentHash([run.scope.logicalRunId, action, records.map(row => row.operationId)]),
    payloadHash: contentHash(records.map(row => row.row)),
  };
}
const result = (batch: PreparedBatch<unknown>, status: "accepted" | "staged" = "accepted"): BatchResult => ({
  outcomes: batch.records.map(row => ({ operationId: row.operationId, status })),
});
beforeAll(async () => {
  container = await new GenericContainer("postgres:18-alpine")
    .withEnvironment({ POSTGRES_PASSWORD: "test", POSTGRES_DB: "artifact_test" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(
    5432
  )}/artifact_test?schema=newjitsu`;
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve("prisma/build/index.js"),
      "db",
      "push",
      `--schema=${fileURLToPath(new URL("../../../../webapps/console/prisma/schema.prisma", import.meta.url))}`,
      "--skip-generate",
    ],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" }
  );
  admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query("SET search_path TO newjitsu");
}, 120000);
beforeEach(async () => {
  await Promise.all(databases.splice(0).map(db => db.close()));
  await admin.query(
    "TRUNCATE reverse_sync_operation,reverse_sync_batch,reverse_sync_control,reverse_sync_target_owner,reverse_sync_membership,reverse_sync_generation,source_state CASCADE"
  );
  objects = new MemoryObjects();
});
afterAll(async () => {
  await Promise.all(databases.map(db => db.close()));
  await admin?.end();
  await container?.stop();
});
describe("object journal", () => {
  it("rejects duplicate operation IDs before publishing any prepared batch", async () => {
    const run = await session();
    await init(run);
    await expect(run.delivery.prepare(batch(run, ["duplicate", "duplicate"]), {})).rejects.toThrow(
      "Duplicate input operation IDs"
    );
    expect(await run.core.recoveryPage()).toEqual([]);
    const first = batch(run, ["same"]);
    await run.delivery.prepare(first, {});
    await run.delivery.acknowledge(first.batchId, result(first), {});
    await expect(run.delivery.prepare(batch(run, ["same", "different"], 2), {})).rejects.toThrow(
      "Duplicate input operation IDs"
    );
    expect(await run.core.recoveryPage()).toHaveLength(1);
    const recovered = await session();
    await expect(recovered.delivery.prepare(batch(recovered, ["same", "different"], 2), {})).rejects.toThrow(
      "Duplicate input operation IDs"
    );
    await recovered.delivery.prepare(batch(recovered, ["different"], 2), {});
    expect((await recovered.core.recoveryStatus()).nextSequence).toBe(2);
  });
  it("reopens a committed head after losing the SQL COMMIT response", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    const original = Client.prototype.query;
    let injected = false;
    const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function (this: Client, ...args: any[]) {
      const response = (original as any).apply(this, args);
      if (args[0] === "COMMIT" && !injected) {
        injected = true;
        return response.then(() => {
          throw new Error("lost response");
        });
      }
      return response;
    });
    try {
      await expect(run.delivery.prepare(b, {})).rejects.toThrow("transaction failed");
    } finally {
      spy.mockRestore();
    }
    expect(injected).toBe(true);
    await expect(run.delivery.prepare(b, {})).rejects.toThrow("reopening");
    const recovered = await session();
    expect(await recovered.core.loadBatch(b.batchId)).toEqual(b);
    await recovered.core.acknowledgeRecovered(b.batchId, result(b), {});
  });
  it("seals large snapshots and compacts large acknowledged membership into bounded artifacts", async () => {
    const scope = input({ mode: "mirror" }),
      run = await openMirrorPersistence(database(), scope);
    await run.delivery.assertReady();
    await run.snapshots.start();
    await run.delivery.prepareInit({});
    await run.delivery.acknowledgeInit({});
    for (let page = 0; page < 4; page++)
      await run.snapshots.append(
        Array.from({ length: 250 }, (_, i) => ({
          key: contentHash(page * 250 + i),
          identities: project("upsert", { id: String(page * 250 + i), payload: "x".repeat(20000) }),
        })),
        page + 1
      );
    await run.snapshots.seal();
    let count = 0;
    for (const ref of (run.core as ObjectJournal).head.snapshot!.parts) {
      expect(ref.bytes).toBeLessThan(16_000_000);
      count += (await (run.core as ObjectJournal).artifacts.get<any[]>(ref)).length;
    }
    expect(count).toBe(1000);
    // Exercise baseline publication using real delivery receipts, not direct SQL seeding.
    let after = "",
      sequence = 0;
    for (;;) {
      const values = await run.snapshots.page("additions", after, 200);
      if (!values.length) break;
      const records = values.map(row => ({
        key: row.identityHash,
        row,
        sourceSequence: ++sequence,
        operationId: contentHash([
          scope.syncId,
          scope.logicalRunId,
          scope.configRevision,
          scope.targetIdentity,
          "upsert",
          row.identityHash,
          contentHash(row),
        ]),
      }));
      const b: PreparedBatch<any> = {
        action: "upsert",
        records,
        batchId: contentHash([scope.logicalRunId, "upsert", records.map(row => row.operationId)]),
        payloadHash: contentHash(records.map(row => row.row)),
      };
      await run.delivery.prepare(b, {});
      await run.delivery.acknowledge(b.batchId, result(b), {});
      after = values.at(-1)!.identityHash;
    }
    await run.delivery.prepareFinish(1000, {});
    await run.delivery.acknowledgeFinish({ delivery: "accepted" }, {});
    await run.delivery.commitCheckpoint({ sourceSequence: 1000 }, {}, true);
    const next = await openMirrorPersistence(database(), { ...scope, logicalRunId: "large-next" });
    expect((next.core as ObjectJournal).head.baseline.length).toBeGreaterThan(1);
    expect((next.core as ObjectJournal).local.stats().entries).toBe(1000);
    const restored = await openMirrorPersistence(database(), { ...scope, logicalRunId: "large-next" });
    expect((restored.core as ObjectJournal).local.stats().entries).toBe(1000);
  }, 30000);
  it("runs asynchronous mirror additions and removals across fresh workers without warehouse re-extraction", async () => {
    const scope = input({ mode: "mirror" });
    const calls: { action: string; rows: number }[] = [];
    const writer: ReverseEtlWriter<JsonObject> = {
      init: async () => {},
      abort: async () => {},
      finish: async () => ({ delivery: "accepted" }),
      upsert: async b => {
        calls.push({ action: "upsert", rows: b.records.length });
        return { ...result(b as PreparedBatch<unknown>, "staged"), remoteJobIds: [b.batchId] };
      },
      remove: async b => {
        calls.push({ action: "remove", rows: b.records.length });
        return { ...result(b as PreparedBatch<unknown>, "staged"), remoteJobIds: [b.batchId] };
      },
      reconcile: async () => ({ delivery: "accepted" }),
    };
    const stream = {
      name: "audience",
      displayName: "Test",
      rowType: z.object({ id: z.string() }),
      removeRowType: z.object({ id: z.string() }),
      options: z.object({}),
      batchSize: 1000,
      batchDelivery: "asynchronous" as const,
      capabilities: {
        supportsUpsert: true,
        supportsExplicitRemove: true,
        mirror: "snapshot-diff" as const,
        replay: "idempotent-operation" as const,
      },
      createWriter: async () => writer,
    };
    const options = (
      run: Awaited<ReturnType<typeof openMirrorPersistence>>
    ): MirrorOptions<{}, { id: string }, {}> => ({
      persistence: run,
      adapter: {
        stream,
        projection: { rowType: stream.rowType, project: row => project("upsert", row) },
        batchDelivery: "asynchronous",
      },
      context: {
        credentials: {},
        options: {},
        signal: new AbortController().signal,
        log: { info() {}, error() {}, warn() {}, debug() {} },
        fetch: async () => {
          throw new Error("no HTTP in test");
        },
      },
      targetBaseline: "tracked",
    });
    let run = await openMirrorPersistence(database(), scope);
    const first = await runSnapshotMirror({
      ...options(run),
      mapping: { id: "id" },
      source: async function* () {
        for (let i = 0; i < 1200; i++) yield { key: contentHash(i), row: { id: String(i) } };
      },
    });
    expect(first.delivery).toBe("pending");
    expect(calls).toEqual([
      { action: "upsert", rows: 1000 },
      { action: "upsert", rows: 200 },
    ]);
    const hooks = { attachWriter: async () => writer, reconcileBatch: async (b: any) => result(b) };
    run = await openMirrorPersistence(database(), scope);
    expect((await resumeSnapshotMirror(options(run), hooks)).delivery).toBe("accepted");
    const nextScope = { ...scope, logicalRunId: "next" };
    run = await openMirrorPersistence(database(), nextScope);
    expect(
      (await runSnapshotMirror({ ...options(run), mapping: { id: "id" }, source: async function* () {} })).delivery
    ).toBe("pending");
    expect(calls.slice(2)).toEqual([
      { action: "remove", rows: 1000 },
      { action: "remove", rows: 200 },
    ]);
    run = await openMirrorPersistence(database(), nextScope);
    expect((await resumeSnapshotMirror(options(run), hooks)).delivery).toBe("accepted");
    expect([...(run.core as ObjectJournal).local.memberPages()].flat()).toEqual([]);
  }, 30000);
  it("retains source ordering when an earlier upsert is accepted after a later removal", async () => {
    const run = await session();
    await init(run);
    const a = batch(run, ["same"]),
      b = batch(run, ["same"], 2, "remove");
    await run.delivery.prepare(a, {});
    await run.delivery.acknowledge(a.batchId, result(a, "staged"), {});
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, result(b), {});
    const recovered = await session();
    await recovered.core.acknowledgeRecovered(a.batchId, result(a), {});
    expect([...(recovered.core as ObjectJournal).local.memberPages()].flat()).toEqual([]);
    const reopened = await session();
    expect([...(reopened.core as ObjectJournal).local.memberPages()].flat()).toEqual([]);
  });
  it("blocks removals after incomplete extraction and restarts unsealed scratch without accepting a partial source", async () => {
    const scope = input({ mode: "mirror" });
    const run = await openMirrorPersistence(database(), scope);
    await run.delivery.assertReady();
    await run.snapshots.start();
    await run.delivery.prepareInit({});
    await run.delivery.acknowledgeInit({});
    await run.snapshots.append([{ key: contentHash(1), identities: project("upsert", { id: "a" }) }], 1);
    const recovered = await openMirrorPersistence(database(), scope);
    expect(await recovered.snapshots.status()).toMatchObject({ sealed: false, sourceKeyCount: 0 });
    await expect(recovered.snapshots.page("removals")).rejects.toThrow("sealed");
  });
  it("prepares and acknowledges 1000 rows with constant PostgreSQL round trips and no per-row writes", async () => {
    const run = await session();
    await init(run);
    const b = batch(
      run,
      Array.from({ length: 1000 }, (_, i) => String(i))
    );
    const spy = vi.spyOn(Client.prototype, "query");
    try {
      await run.delivery.prepare(b, {});
      await run.delivery.acknowledge(b.batchId, result(b), {});
      expect(spy.mock.calls.length).toBeLessThan(25);
    } finally {
      spy.mockRestore();
    }
    for (const table of [
      "reverse_sync_batch",
      "reverse_sync_operation",
      "reverse_sync_membership",
      "reverse_sync_desired",
      "reverse_sync_source_key",
    ])
      expect((await admin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    await run.delivery.prepareFinish(1000, {});
    await run.delivery.acknowledgeFinish({ delivery: "accepted" }, {});
    await run.delivery.commitCheckpoint({ sourceSequence: 1000 }, {}, true);
    expect((await run.core.recoveryStatus()).phase).toBe("complete");
  });
  it("restores exact batches after losing all scratch state, without trusting unreconciled acknowledgements", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a", "b"]);
    await run.delivery.prepare(b, {});
    await run.core.db.close();
    databases.splice(databases.indexOf(run.core.db), 1);
    const recovered = await session();
    expect(recovered.recovery).toBe(true);
    expect(await recovered.core.loadBatch(b.batchId)).toEqual(b);
    await expect(recovered.delivery.acknowledge(b.batchId, result(b), {})).rejects.toThrow("explicit reconciliation");
    await recovered.core.acknowledgeRecovered(b.batchId, result(b), {});
    expect((await recovered.core.recoveryBatch(b.batchId)).operations.every(row => row.status === "accepted")).toBe(
      true
    );
  });
  it("preserves accepted partial effects after abort and next-run compaction", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["accepted", "rejected"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(
      b.batchId,
      {
        outcomes: [
          { operationId: b.records[0].operationId, status: "accepted" },
          { operationId: b.records[1].operationId, status: "rejected", code: "BAD", safeReason: "Invalid row" },
        ],
      },
      {}
    );
    await run.delivery.prepareAbort();
    await run.delivery.acknowledgeAbort();
    const next = await session(input({ logicalRunId: "next" }));
    expect((await next.core.recoveryStatus()).phase).toBe("new");
    // Baseline is durable even when the prior run never committed a checkpoint.
    expect([...(next.core as ObjectJournal).local.memberPages()].flat().map(row => row.effect.identity)).toEqual([
      "accepted",
    ]);
  });
  it("never erases prepared evidence when upload or SQL commit fails", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    objects.failPut = true;
    await expect(run.delivery.prepare(b, {})).rejects.toThrow("upload failed");
    objects.failPut = false;
    expect(await run.core.recoveryPage()).toEqual([]);
    await run.delivery.prepare(b, {});
    await admin.query(
      "ALTER TABLE reverse_sync_control ADD CONSTRAINT injected_failure CHECK(phase<>'finish_prepared') NOT VALID"
    );
    try {
      await run.delivery.acknowledge(b.batchId, result(b), {});
      await expect(run.delivery.prepareFinish(1, {})).rejects.toThrow("transaction failed");
    } finally {
      await admin.query("ALTER TABLE reverse_sync_control DROP CONSTRAINT injected_failure");
    }
    const recovered = await session();
    expect((await recovered.core.recoveryBatch(b.batchId)).operations[0].status).toBe("accepted");
    expect((await recovered.core.recoveryStatus()).phase).toBe("running");
  });
  it("rejects corrupt recovery artifacts and legacy state rather than falling back or resetting", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    objects.objects.clear();
    await expect(session()).rejects.toThrow("missing or corrupt");
    const legacy = new Database({ connectionString: url });
    databases.push(legacy);
    await expect(openPersistence(legacy, input(), project)).rejects.toThrow("no PostgreSQL fallback");
    await admin.query("UPDATE reverse_sync_control SET artifact_head=NULL");
    await expect(session()).rejects.toThrow("explicit test-sync reset");
  });
  it("preserves terminal receipts and stores when duplicate acknowledgements arrive", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, result(b), { newer: true });
    await run.delivery.acknowledge(b.batchId, result(b), { older: true });
    expect((await run.core.state()).store).toEqual({ newer: true });
    await expect(run.delivery.acknowledge(b.batchId, result(b, "staged"), {})).rejects.toThrow("terminal receipt");
  });
  it("seals local deduplication into durable snapshot files and restores paged diffs", async () => {
    const scope = input({ mode: "mirror" });
    const run = await openMirrorPersistence(database(), scope);
    await run.delivery.assertReady();
    await run.snapshots.start();
    await run.delivery.prepareInit({});
    await run.delivery.acknowledgeInit({});
    await run.snapshots.append(
      [
        { key: contentHash(1), identities: project("upsert", { id: "a" }) },
        { key: contentHash(2), identities: project("upsert", { id: "a" }) },
      ],
      1
    );
    await run.snapshots.seal();
    const recovered = await openMirrorPersistence(database(), scope);
    expect(await recovered.snapshots.status()).toMatchObject({ sealed: true, sourceKeyCount: 2 });
    expect(await recovered.snapshots.page("additions")).toEqual(effects(project("upsert", { id: "a" })));
    await expect(recovered.snapshots.page("removals")).rejects.toThrow("not durably accepted");
  });
});
