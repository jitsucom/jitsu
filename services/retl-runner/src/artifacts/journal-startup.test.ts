import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { Client } from "pg";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PreparedBatch, BatchResult } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { Database, openPersistence, type RunInput } from "../persistence";
import { MemoryObjects } from "./test-support";

/** Object store whose reads take `latencyMs`, like a real bucket, and that records how reads overlap. */
class LatentObjects extends MemoryObjects {
  latencyMs = 0;
  reads = 0;
  inflight = 0;
  maxInflight = 0;
  async get(key: string, max: number, signal: AbortSignal) {
    this.reads++;
    this.maxInflight = Math.max(this.maxInflight, ++this.inflight);
    try {
      if (this.latencyMs) await new Promise(resolve => setTimeout(resolve, this.latencyMs));
      return await super.get(key, max, signal);
    } finally {
      this.inflight--;
    }
  }
}

let container: StartedTestContainer, admin: Client, url: string, objects: LatentObjects;
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

function batch(run: Session, ids: string[], start: number): PreparedBatch<any> {
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
        "upsert",
        key,
        contentHash(row),
      ]),
    };
  });
  return {
    action: "upsert",
    records,
    batchId: contentHash([run.scope.logicalRunId, "upsert", records.map(row => row.operationId)]),
    payloadHash: contentHash(records.map(row => row.row)),
  };
}
const accepted = (b: PreparedBatch<unknown>): BatchResult => ({
  outcomes: b.records.map(row => ({ operationId: row.operationId, status: "accepted" })),
});

/** Commit `count` accepted batches of `size` records in one logical run, as a finished full-table run leaves behind. */
async function history(count: number, finish = true, size = 5) {
  const run = await session();
  await run.delivery.assertReady();
  await run.delivery.prepareInit({});
  await run.delivery.acknowledgeInit({});
  let last: PreparedBatch<any> | undefined;
  for (let i = 0; i < count; i++) {
    const ids = Array.from({ length: size }, (_, j) => `row-${i}-${j}`);
    const b = (last = batch(run, ids, i * size + 1));
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, accepted(b), {});
  }
  if (!finish) return;
  // End the run the way a real one ends, so the next logical run may open.
  const point = { sourceSequence: last!.records.at(-1)!.sourceSequence };
  await run.delivery.prepareFinish(point.sourceSequence, {});
  await run.delivery.acknowledgeFinish({ delivery: "accepted" }, {});
  await run.delivery.commitCheckpoint(point, {}, true);
}

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
  await admin.query("TRUNCATE reverse_sync_control,reverse_sync_target_owner,source_state CASCADE");
  objects = new LatentObjects();
});
afterAll(async () => {
  await Promise.all(databases.map(db => db.close()));
  await admin?.end();
  await container?.stop();
});

describe("journal startup", () => {
  // Opening a journal used to read its stored pages and batches one at a time (3 object-store round trips per batch), so
  // the start of a run after a finished full-table run took minutes. The reads are independent and must overlap.
  it.each([
    ["the next logical run", "r2"],
    ["the same logical run (recovery)", "r"],
  ])(
    "reads the stored history of %s concurrently and restores all of it",
    async (_name, logicalRunId) => {
      const count = 40;
      await history(count, logicalRunId !== "r");
      objects.latencyMs = 5;
      objects.reads = 0;
      objects.maxInflight = 0;
      const reopened = await session(input({ logicalRunId }));
      expect(objects.maxInflight).toBeGreaterThan(1);
      expect(objects.maxInflight).toBeLessThanOrEqual(2 * 16); // bounded: groups of 16 batches, 2 reads in flight per batch
      // Nothing is skipped: 3 reads per batch (stored batch, its effects, its receipt) plus the head and baseline pages.
      expect(objects.reads).toBeGreaterThanOrEqual(3 * count);
      if (logicalRunId === "r") expect(reopened.core.head.batches).toHaveLength(count);
      else expect(reopened.core.head.baseline.length).toBeGreaterThan(0);
    },
    60000
  );
});
