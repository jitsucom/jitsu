import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { Client, type PoolConfig } from "pg";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { contentHash, createBufferedSyncStore } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { runReverseEtl } from "@jitsu/destination-functions/src/reverse-etl/run";
import type { BatchResult, FinishResult, PreparedBatch } from "@jitsu/protocols/reverse-etl";
import { z } from "zod";
import { effects } from "./snapshots";
import { encryptedByteBudget } from "./crypto";
import { Cipher, Database, openPersistence, release, renew, prune, type RunInput, type Project } from "./index";

let container: StartedTestContainer;
let admin: Client;
let db: Database;
let runtimeConfig: PoolConfig;
let adminUrl: string;
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
// Test-only provisioning uses the standard Prisma command, just like console deployment.
function pushSchema(databaseUrl: string) {
  const schema = fileURLToPath(new URL("../../../../webapps/console/prisma/schema.prisma", import.meta.url));
  execFileSync(process.execPath, [prismaCli, "db", "push", `--schema=${schema}`, "--skip-generate"], {
    // eslint-disable-next-line no-restricted-properties -- only the disposable test database is passed to Prisma.
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}
const cipher = new Cipher("test", { test: randomBytes(32) });
const project: Project = (_, row: any) => [{ identity: row.id, upsert: row, remove: { id: row.id } }];
const input = (extra: Partial<RunInput> = {}): RunInput => ({
  workspaceId: "workspace",
  syncId: "sync",
  taskId: "task",
  logicalRunId: "run",
  configRevision: "revision",
  targetIdentity: "provider/account/audience",
  mode: "upsert",
  extraction: "cursor",
  ...extra,
});
let runInput: RunInput;
type Session = Awaited<ReturnType<typeof openPersistence>>;
async function session(extra: Partial<RunInput> = {}): Promise<Session> {
  return openPersistence(db, { ...runInput, ...extra }, project);
}
async function init(run: Session) {
  await run.delivery.assertReady();
  await run.delivery.prepareInit({});
  await run.delivery.acknowledgeInit({});
}
function batch(
  run: Session,
  ids: string[],
  start = 1,
  action: "upsert" | "remove" = "upsert",
  cursor = true
): PreparedBatch<any> {
  const records = ids.map((id, index) => {
    const row = { id };
    const key = contentHash([id]);
    return {
      key,
      row,
      sourceSequence: start + index,
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
    batchId: contentHash([run.scope.logicalRunId, action, records.map(r => r.operationId)]),
    payloadHash: contentHash(records.map(r => r.row)),
    ...(cursor ? { cursor: { value: String(start + ids.length - 1), primaryKeyValues: [ids[ids.length - 1]] } } : {}),
  };
}
function outcomes(b: PreparedBatch<unknown>, status: "accepted" | "staged" = "accepted"): BatchResult {
  return { outcomes: b.records.map(r => ({ operationId: r.operationId, status })) };
}
async function count(table: string) {
  return Number((await admin.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
}
async function expire() {
  await admin.query("UPDATE newjitsu.reverse_sync_control SET lease_until=clock_timestamp()-interval '1 second'");
}
async function finish(run: Session, b?: PreparedBatch<unknown>) {
  const point = b
    ? { sourceSequence: b.records.at(-1)!.sourceSequence, ...(b.cursor ? { cursor: b.cursor } : {}) }
    : { sourceSequence: 0 };
  await run.delivery.prepareFinish(point.sourceSequence, {});
  if (run.recovery) await run.core.acknowledgeRecoveredFinish({ delivery: "accepted" }, {});
  else await run.delivery.acknowledgeFinish({ delivery: "accepted" }, {});
  await run.delivery.commitCheckpoint(point, {}, true);
}

beforeAll(async () => {
  container = await new GenericContainer("postgres:18-alpine")
    .withEnvironment({ POSTGRES_PASSWORD: "test", POSTGRES_DB: "retl_test" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const config = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: "retl_test",
    user: "postgres",
    password: "test",
  };
  admin = new Client(config);
  await admin.connect();
  adminUrl = `postgresql://postgres:test@${config.host}:${config.port}/${config.database}?schema=newjitsu`;
  pushSchema(adminUrl);
  await admin.query(
    "CREATE ROLE retl_runtime LOGIN PASSWORD 'runtime'; GRANT USAGE ON SCHEMA newjitsu TO retl_runtime"
  );
  const tables = await admin.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='newjitsu' AND starts_with(tablename,'reverse_sync_')"
  );
  for (const { tablename } of tables.rows) {
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON newjitsu."${tablename}" TO retl_runtime`);
  }
  await admin.query("GRANT SELECT,INSERT,UPDATE ON newjitsu.source_state TO retl_runtime");
  runtimeConfig = { ...config, user: "retl_runtime", password: "runtime" };
  db = new Database(runtimeConfig, cipher);
}, 120000);
beforeEach(async () => {
  runInput = input();
  await admin.query(
    "TRUNCATE newjitsu.reverse_sync_operation,newjitsu.reverse_sync_batch,newjitsu.reverse_sync_control,newjitsu.reverse_sync_target_owner,newjitsu.reverse_sync_generation,newjitsu.reverse_sync_source_key,newjitsu.reverse_sync_desired,newjitsu.reverse_sync_membership,newjitsu.source_state"
  );
});
afterAll(async () => {
  await db?.close();
  await admin?.end();
  await container?.stop();
});

describe("PostgreSQL persistence", () => {
  it("keeps Prisma-owned tables, constraints and existing rows intact across schema updates", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b), {});
    pushSchema(adminUrl);
    expect(await count("newjitsu.reverse_sync_operation")).toBe(1);
    expect(await count("newjitsu.reverse_sync_membership")).toBe(1);
    expect((await admin.query("SELECT 1 FROM pg_namespace WHERE nspname='retl'")).rowCount).toBe(0);
    expect(
      (
        await admin.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='newjitsu' AND tablename IN ('reverse_sync_activation','reverse_sync_outbox','reverse_sync_association')"
        )
      ).rows
    ).toEqual([]);
    expect(
      (
        await admin.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='newjitsu' AND table_name='reverse_sync_control' AND column_name LIKE 'billing_%'"
        )
      ).rows
    ).toEqual([]);
    await expect(admin.query("UPDATE newjitsu.reverse_sync_control SET mode='invalid'")).rejects.toThrow(/enum/);
    await expect(admin.query("UPDATE newjitsu.reverse_sync_operation SET batch_id='missing'")).rejects.toThrow(
      /foreign key/
    );
    await expect(
      admin.query("INSERT INTO newjitsu.reverse_sync_operation SELECT * FROM newjitsu.reverse_sync_operation")
    ).rejects.toThrow(/duplicate key/);
  }, 30000);
  it("uses the configured schema for every transaction without relying on pooled search_path", async () => {
    const schema = "other_config";
    const url = new URL(adminUrl);
    url.searchParams.set("schema", schema);
    pushSchema(url.toString());
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO retl_runtime`);
    const tables = await admin.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 AND starts_with(tablename,'reverse_sync_')",
      [schema]
    );
    for (const { tablename } of tables.rows)
      await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${schema}."${tablename}" TO retl_runtime`);
    await admin.query(`GRANT SELECT,INSERT,UPDATE ON ${schema}.source_state TO retl_runtime`);
    url.username = "retl_runtime";
    url.password = "runtime";
    const custom = new Database({ connectionString: url.toString(), options: "-c search_path=public" }, cipher);
    try {
      const run = await openPersistence(custom, runInput, project);
      await init(run);
      const b = batch(run, ["a"]);
      await run.delivery.prepare(b, {});
      await run.delivery.acknowledge(b.batchId, outcomes(b), {});
      await finish(run, b);
      expect(await count(`${schema}.reverse_sync_control`)).toBe(1);
      expect(await count(`${schema}.source_state`)).toBe(1);
      expect(await count("newjitsu.reverse_sync_control")).toBe(0);
      expect(await count("newjitsu.source_state")).toBe(0);
      const path = await custom.pool.query("SHOW search_path");
      expect(path.rows[0].search_path).toBe("public");
    } finally {
      await custom.close();
    }
  }, 30000);
  it("uses a restricted runtime role and a provider facade without database or snapshot access", async () => {
    const run = await session();
    expect(Object.keys(run.delivery)).not.toContain("db");
    expect(Object.keys(run.delivery)).not.toContain("snapshots");
    await expect(db.pool.query("CREATE TABLE newjitsu.reverse_sync_forbidden (id int)")).rejects.toThrow(
      /permission denied/
    );
    await expect(db.pool.query('SELECT * FROM newjitsu."Workspace"')).rejects.toThrow(/permission denied/);
  });
  it("allows only one concurrent owner, and fences every old owner after takeover", async () => {
    const competing = await Promise.allSettled([session(), session({ taskId: "other" })]);
    expect(competing.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const old = (competing.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Session>).value;
    await expire();
    const next = await session({ taskId: "recovery" });
    expect(BigInt(next.scope.fencingEpoch)).toBeGreaterThan(BigInt(old.scope.fencingEpoch));
    await expect(old.delivery.prepareInit({})).rejects.toThrow(/ownership/);
    await expect(renew(db, old.scope)).rejects.toThrow(/ownership/);
    await expect(release(db, old.scope)).rejects.toThrow(/ownership/);
    await init(next);
  });
  it("rolls back a transaction that crosses lease expiry", async () => {
    const run = await openPersistence(db, runInput, project, 100);
    await expect(
      db.owned(run.scope, async client => {
        await client.query("UPDATE newjitsu.reverse_sync_control SET phase='running'");
        await client.query("SELECT pg_sleep(0.15)");
      })
    ).rejects.toThrow(/ownership/);
    expect((await admin.query("SELECT phase FROM newjitsu.reverse_sync_control")).rows[0].phase).toBe("new");
  });
  it("isolates workspaces and binds ciphertext to its scope", async () => {
    const run = await session();
    await init(run);
    await expect(session({ workspaceId: "foreign" })).rejects.toThrow();
    const b = batch(run, ["private@example.com"]);
    await run.delivery.prepare(b, { token: "secret" });
    const saved = (await admin.query("SELECT manifest FROM newjitsu.reverse_sync_batch")).rows[0].manifest;
    expect(saved.toString()).not.toContain("private@example.com");
    expect(
      (await admin.query("SELECT store FROM newjitsu.reverse_sync_control")).rows[0].store.toString()
    ).not.toContain("secret");
    expect(() =>
      cipher.open(saved, db.aad({ workspaceId: "foreign", syncId: "sync" }, `batch:run:${b.batchId}`))
    ).toThrow(/decrypt/);
    expect(await run.core.loadBatch(b.batchId)).toEqual(b);
  });
  it("persists preparation across process recreation and blocks blind new extraction", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await db.close();
    db = new Database(runtimeConfig, cipher);
    await expire();
    await expect(session({ logicalRunId: "new-run" })).rejects.toThrow(/requires recovery/);
    const recovered = await session({ taskId: "recovery" });
    expect(recovered.recovery).toBe(true);
    await expect(recovered.delivery.assertReady()).rejects.toThrow(/Recover/);
    expect(await recovered.core.loadBatch(b.batchId)).toEqual(b);
    await expect(recovered.delivery.acknowledge(b.batchId, outcomes(b), {})).rejects.toThrow(/explicit reconciliation/);
    await recovered.core.acknowledgeRecovered(b.batchId, outcomes(b), {});
    await finish(recovered, b);
  });
  it.each(
    (["prepared", "unknown", "staged"] as const).flatMap(initial =>
      (["accepted", "rejected", "staged"] as const).map(outcome => ({ initial, outcome }))
    )
  )("requires core reconciliation for recovered $initial -> $outcome batches", async ({ initial, outcome }) => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, { saved: true });
    if (initial === "unknown") await run.delivery.markUnknown(b.batchId);
    if (initial === "staged") await run.delivery.acknowledge(b.batchId, outcomes(b, "staged"), { saved: true });
    await release(db, run.scope);
    const recovered = await session({ taskId: "recovery" });
    const before = await recovered.core.recoveryBatch(b.batchId);
    const counters = (
      await admin.query("SELECT reserved_entries,reserved_bytes,journal_bytes FROM newjitsu.reverse_sync_control")
    ).rows[0];
    const result: BatchResult = {
      outcomes: [
        outcome === "rejected"
          ? { operationId: b.records[0].operationId, status: outcome, code: "invalid", safeReason: "Invalid row" }
          : { operationId: b.records[0].operationId, status: outcome },
      ],
    };
    await expect(recovered.delivery.acknowledge(b.batchId, result, { changed: true })).rejects.toThrow(
      /explicit reconciliation/
    );
    expect(await recovered.core.recoveryBatch(b.batchId)).toEqual(before);
    expect((await recovered.core.state()).store).toEqual({ saved: true });
    expect(
      (await admin.query("SELECT reserved_entries,reserved_bytes,journal_bytes FROM newjitsu.reverse_sync_control"))
        .rows[0]
    ).toEqual(counters);
    expect(await count("newjitsu.reverse_sync_membership")).toBe(0);
    if (initial !== "staged") await expect(recovered.delivery.prepareAbort()).rejects.toThrow(/reconciliation/);
    await recovered.core.acknowledgeRecovered(b.batchId, result, {});
    expect((await recovered.core.recoveryBatch(b.batchId)).operations[0].status).toBe(outcome);
    if (outcome !== "staged") {
      const terminal = await recovered.core.recoveryBatch(b.batchId);
      await recovered.delivery.acknowledge(b.batchId, result, {});
      expect(await recovered.core.recoveryBatch(b.batchId)).toEqual(terminal);
    }
  });
  it.each([false, true].flatMap(hasRows => [false, true].map(pending => ({ hasRows, pending }))))(
    "requires reconciliation for recovered finish without staged rows (hasRows=$hasRows, pending=$pending)",
    async ({ hasRows, pending }) => {
      const run = await session();
      await init(run);
      const b = hasRows ? batch(run, ["a"]) : undefined;
      if (b) {
        await run.delivery.prepare(b, {});
        await run.delivery.acknowledge(b.batchId, outcomes(b), {});
      }
      await run.delivery.prepareFinish(hasRows ? 1 : 0, { saved: true });
      if (pending)
        await run.delivery.acknowledgeFinish({ delivery: "pending", remoteJobIds: ["job"] }, { saved: true });
      await release(db, run.scope);
      const recovered = await session({ taskId: "recovery" });
      const before = await recovered.core.recoveryStatus();
      await expect(recovered.delivery.acknowledgeFinish({ delivery: "accepted" }, { changed: true })).rejects.toThrow(
        /explicit reconciliation/
      );
      expect(await recovered.core.recoveryStatus()).toEqual(before);
      expect((await recovered.core.state()).store).toEqual({ saved: true });
      const point = { sourceSequence: hasRows ? 1 : 0, ...(b ? { cursor: b.cursor } : {}) };
      await expect(recovered.delivery.commitCheckpoint(point, {}, true)).rejects.toThrow(/phase/);
      expect(await count("newjitsu.source_state")).toBe(0);
      await recovered.core.acknowledgeRecoveredFinish({ delivery: "accepted" }, {});
      await recovered.delivery.commitCheckpoint(point, {}, true);
      expect(await count("newjitsu.source_state")).toBe(1);
    }
  );
  it("acknowledges membership and receipts atomically, including accepted-then-failed runs", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a", "b"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(
      b.batchId,
      {
        outcomes: [
          { operationId: b.records[0].operationId, status: "accepted" },
          { operationId: b.records[1].operationId, status: "rejected", code: "invalid", safeReason: "Invalid row" },
        ],
      },
      {}
    );
    expect(await count("newjitsu.reverse_sync_membership")).toBe(1);
    await expect(run.delivery.commitCheckpoint({ sourceSequence: 2, cursor: b.cursor }, {}, false)).rejects.toThrow(
      /unaccepted/
    );
    await run.delivery.prepareAbort();
    await run.delivery.acknowledgeAbort();
    expect(await count("newjitsu.reverse_sync_membership")).toBe(1);
  });
  it("rolls back all acceptance writes when saving the batch receipt fails", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await admin.query(
      "ALTER TABLE newjitsu.reverse_sync_batch ADD CONSTRAINT injected_failure CHECK (status <> 'acknowledged') NOT VALID"
    );
    try {
      await expect(run.delivery.acknowledge(b.batchId, outcomes(b), {})).rejects.toThrow();
    } finally {
      await admin.query("ALTER TABLE newjitsu.reverse_sync_batch DROP CONSTRAINT injected_failure");
    }
    expect(await count("newjitsu.reverse_sync_membership")).toBe(0);
    expect((await admin.query("SELECT status FROM newjitsu.reverse_sync_operation")).rows[0].status).toBe("prepared");
    await run.delivery.acknowledge(b.batchId, outcomes(b), {});
    expect(await count("newjitsu.reverse_sync_membership")).toBe(1);
  });
  it("deduplicates accepted receipts and membership updates", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b), {});
    await run.delivery.acknowledge(b.batchId, outcomes(b), {});
    await run.delivery.markUnknown(b.batchId);
    expect((await admin.query("SELECT status FROM newjitsu.reverse_sync_operation")).rows[0].status).toBe("accepted");
    await finish(run, b);
    await expire();
    const next = await session({ logicalRunId: "run2", taskId: "task2" });
    await init(next);
    const b2 = batch(next, ["b"], 2);
    await next.delivery.prepare(b2, {});
    await next.delivery.acknowledge(b2.batchId, outcomes(b2), {});
    expect(await count("newjitsu.reverse_sync_membership")).toBe(2);
    expect(await count("newjitsu.reverse_sync_operation")).toBe(2);
    expect(
      Number(
        (await admin.query("SELECT membership_entries FROM newjitsu.reverse_sync_control")).rows[0].membership_entries
      )
    ).toBe(2);
  });
  it.each([false, true].flatMap(recovery => [false, true].map(rejected => ({ recovery, rejected }))))(
    "keeps terminal receipts immutable and ignores duplicate store snapshots (recovery=$recovery, rejected=$rejected)",
    async ({ recovery, rejected }) => {
      const run = await session();
      await init(run);
      const b = batch(run, ["accepted", "rejected"]);
      await run.delivery.prepare(b, {});
      const result: BatchResult = {
        outcomes: [
          { operationId: b.records[0].operationId, status: "accepted" },
          rejected
            ? { operationId: b.records[1].operationId, status: "rejected", code: "invalid", safeReason: "Invalid row" }
            : { operationId: b.records[1].operationId, status: "accepted" },
        ],
        remoteJobIds: ["original-job"],
        providerCheckpoint: { cursor: "original" },
      };
      await run.delivery.acknowledge(b.batchId, result, { version: 1 });
      if (!rejected) {
        const later = batch(run, ["later"], 3);
        await run.delivery.prepare(later, {});
        await run.delivery.acknowledge(later.batchId, outcomes(later), { version: 2 });
      }
      let active = run;
      if (recovery) {
        await release(db, run.scope);
        active = await session({ taskId: "recovery" });
      }
      const snapshot = async () => ({
        receipt: (
          await admin.query("SELECT result,result_bytes FROM newjitsu.reverse_sync_batch WHERE batch_id=$1", [
            b.batchId,
          ])
        ).rows[0],
        control: (
          await admin.query(
            "SELECT store,journal_bytes,reserved_entries,reserved_bytes,membership_entries,membership_bytes FROM newjitsu.reverse_sync_control"
          )
        ).rows[0],
        operations: (await active.core.recoveryBatch(b.batchId)).operations,
      });
      const before = await snapshot();
      // Outcome ordering and object key ordering are not changes to a receipt.
      const duplicate = {
        providerCheckpoint: result.providerCheckpoint,
        remoteJobIds: result.remoteJobIds,
        outcomes: [...result.outcomes].reverse(),
      };
      await active.delivery.acknowledge(b.batchId, duplicate, { version: 1 });
      await active.core.acknowledgeRecovered(b.batchId, duplicate, { version: 0 });
      expect(await snapshot()).toEqual(before);
      expect((await active.core.state()).store).toEqual({ version: rejected ? 1 : 2 });
      for (const changed of [
        { ...result, remoteJobIds: ["different-job"] },
        { ...result, providerCheckpoint: { cursor: "different" } },
        { outcomes: result.outcomes },
        {
          ...result,
          outcomes: [
            result.outcomes[0],
            { ...result.outcomes[1], status: "rejected" as const, code: "different", safeReason: "Different reason" },
          ],
        },
      ]) {
        await expect(active.delivery.acknowledge(b.batchId, changed, { version: 0 })).rejects.toThrow(
          /terminal batch receipt/
        );
        await expect(active.core.acknowledgeRecovered(b.batchId, changed, { version: 0 })).rejects.toThrow(
          /terminal batch receipt/
        );
        expect(await snapshot()).toEqual(before);
      }
    }
  );
  it("permits staged receipt reconciliation and freezes its final result", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, { ...outcomes(b, "staged"), remoteJobIds: ["pending"] }, { version: 1 });
    await release(db, run.scope);
    const recovered = await session({ taskId: "recovery" });
    const final = { ...outcomes(b), remoteJobIds: ["completed"], providerCheckpoint: { cursor: "final" } };
    await recovered.core.acknowledgeRecovered(b.batchId, final, { version: 2 });
    expect((await recovered.core.recoveryBatch(b.batchId)).result).toEqual(final);
    expect(await count("newjitsu.reverse_sync_membership")).toBe(1);
    await recovered.core.acknowledgeRecovered(b.batchId, final, { version: 1 });
    expect((await recovered.core.state()).store).toEqual({ version: 2 });
  });
  it("completes an empty run without creating delivery receipts", async () => {
    const run = await session();
    await init(run);
    await finish(run);
    expect(await count("newjitsu.reverse_sync_operation")).toBe(0);
    expect(await count("newjitsu.reverse_sync_membership")).toBe(0);
    expect(await count("newjitsu.source_state")).toBe(1);
  });
  it("blocks a checkpoint past a staged delete even if a later upsert is accepted", async () => {
    const run = await session();
    await init(run);
    const a = batch(run, ["a"], 1, "remove");
    await run.delivery.prepare(a, {});
    await run.delivery.acknowledge(a.batchId, outcomes(a, "staged"), {});
    const b = batch(run, ["b"], 2);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b), {});
    await expect(run.delivery.commitCheckpoint({ sourceSequence: 2, cursor: b.cursor }, {}, false)).rejects.toThrow(
      /unaccepted/
    );
    expect(await count("newjitsu.source_state")).toBe(0);
  });
  it("resolves pending finish before checkpointing or accepting staged work", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b, "staged"), {});
    await run.delivery.prepareFinish(1, {});
    await run.delivery.acknowledgeFinish({ delivery: "pending", remoteJobIds: ["job"] }, {});
    await expect(run.delivery.commitCheckpoint({ sourceSequence: 1, cursor: b.cursor }, {}, true)).rejects.toThrow();
    await expect(run.delivery.prepareAbort()).rejects.toThrow();
    await expire();
    const recovered = await session({ taskId: "recovery" });
    await expect(recovered.delivery.acknowledgeFinish({ delivery: "accepted" }, {})).rejects.toThrow(
      /explicit reconciliation/
    );
    expect((await recovered.core.recoveryBatch(b.batchId)).operations[0].status).toBe("staged");
    await recovered.core.acknowledgeRecoveredFinish({ delivery: "accepted" }, {});
    await recovered.delivery.commitCheckpoint({ sourceSequence: 1, cursor: b.cursor }, {}, true);
    expect(await count("newjitsu.reverse_sync_membership")).toBe(1);
  });
  it.each([false, true].flatMap(recovery => [false, true].map(staged => ({ recovery, staged }))))(
    "preserves pending finish receipts until accepted (recovery=$recovery, staged=$staged)",
    async ({ recovery, staged }) => {
      const run = await session();
      await init(run);
      const b = staged ? batch(run, ["a"]) : undefined;
      if (b) {
        await run.delivery.prepare(b, {});
        await run.delivery.acknowledge(b.batchId, outcomes(b, "staged"), {});
      }
      const point = { sourceSequence: staged ? 1 : 0, ...(b ? { cursor: b.cursor } : {}) };
      await run.delivery.prepareFinish(point.sourceSequence, {});
      const result: FinishResult = {
        delivery: "pending",
        remoteJobIds: ["original-job"],
        providerCheckpoint: { cursor: "original", version: 1 },
      };
      await run.delivery.acknowledgeFinish(result, { version: 1 });
      let active = run;
      if (recovery) {
        await release(db, run.scope);
        active = await session({ taskId: "recovery" });
      }
      const snapshot = async () =>
        (
          await admin.query(
            "SELECT phase,finish_result,store,journal_bytes,reserved_entries,reserved_bytes FROM newjitsu.reverse_sync_control"
          )
        ).rows[0];
      const before = await snapshot();
      for (const changed of [
        { ...result, remoteJobIds: ["different-job"] },
        { ...result, providerCheckpoint: { cursor: "different" } },
        { delivery: "pending" as const, remoteJobIds: result.remoteJobIds },
      ]) {
        await expect(active.delivery.acknowledgeFinish(changed, { version: 0 })).rejects.toThrow(
          /pending finish receipt/
        );
        await expect(active.core.acknowledgeRecoveredFinish(changed, { version: 0 })).rejects.toThrow(
          /pending finish receipt/
        );
        expect(await snapshot()).toEqual(before);
      }
      const duplicate = { ...result, providerCheckpoint: { version: 1, cursor: "original" } };
      await active.delivery.acknowledgeFinish(duplicate, { version: 0 });
      await active.core.acknowledgeRecoveredFinish(duplicate, { version: 2 });
      expect(await snapshot()).toEqual(before);
      expect((await active.core.recoveryStatus()).finish).toEqual(result);
      expect((await active.core.state()).store).toEqual({ version: 1 });
      expect(await count("newjitsu.reverse_sync_membership")).toBe(0);
      if (recovery) {
        await expect(active.delivery.acknowledgeFinish({ delivery: "accepted" }, {})).rejects.toThrow(
          /explicit reconciliation/
        );
        await active.core.acknowledgeRecoveredFinish({ delivery: "accepted" }, {});
      } else {
        await active.delivery.acknowledgeFinish({ delivery: "accepted" }, {});
      }
      await active.delivery.commitCheckpoint(point, {}, true);
      expect(await count("newjitsu.reverse_sync_membership")).toBe(staged ? 1 : 0);
      expect(await count("newjitsu.source_state")).toBe(1);
    }
  );
  it("rejects gaps, invented cursors and terminal receipt downgrades", async () => {
    const run = await session();
    await init(run);
    await expect(run.delivery.prepare(batch(run, ["gap"], 2), {})).rejects.toThrow(/contiguous/);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b), {});
    await expect(run.delivery.acknowledge(b.batchId, outcomes(b, "staged"), {})).rejects.toThrow(/terminal/);
    await expect(
      run.delivery.commitCheckpoint(
        { sourceSequence: 1, cursor: { value: "invention", primaryKeyValues: ["a"] } },
        {},
        false
      )
    ).rejects.toThrow(/cursor/);
  });
  it("preserves receipts during full refresh and disallows intermediate full-query checkpoints", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b), {});
    await finish(run, b);
    await expire();
    const next = await session({ taskId: "task2", logicalRunId: "run2", extraction: "full" });
    expect(await next.delivery.assertReady()).toEqual({ sourceSequence: 0 });
    await init(next);
    const b2 = batch(next, ["b"]);
    await next.delivery.prepare(b2, {});
    await next.delivery.acknowledge(b2.batchId, outcomes(b2), {});
    await expect(next.delivery.commitCheckpoint({ sourceSequence: 1, cursor: b2.cursor }, {}, false)).rejects.toThrow();
    expect(await count("newjitsu.reverse_sync_operation")).toBe(2);
    expect(await count("newjitsu.reverse_sync_membership")).toBe(2);
  });
  it("runs the merged lifecycle with the PostgreSQL journal", async () => {
    const run = await session({ extraction: "full" });
    const stream: any = {
      name: "test",
      displayName: "Test",
      rowType: z.object({ id: z.string() }),
      options: z.object({}),
      batchSize: 2,
      capabilities: {
        supportsUpsert: true,
        supportsExplicitRemove: false,
        mirror: "none",
        replay: "idempotent-operation",
      },
      createWriter: async () => ({
        init: async () => {},
        upsert: async (b: any) => outcomes(b),
        finish: async () => ({ delivery: "accepted" }),
        abort: async () => {},
      }),
    };
    const result = await runReverseEtl({
      stream,
      context: {
        ...run.scope,
        mode: "upsert",
        fullRefresh: false,
        credentials: {},
        options: {},
        signal: new AbortController().signal,
        log: {} as any,
        fetch: fetch as any,
        store: createBufferedSyncStore(),
        delivery: run.delivery,
      },
      mapping: { id: "id" },
      checkpointEvery: 1,
      source: async function* () {
        yield { key: contentHash(["a"]), row: { id: "a" }, deleted: false };
        yield { key: contentHash(["b"]), row: { id: "b" }, deleted: false };
      },
    });
    expect(result).toEqual({ delivery: "accepted", sourceSequence: 2 });
    expect(await count("newjitsu.reverse_sync_membership")).toBe(2);
  });
});

describe("recovery and operational boundaries", () => {
  it("does not renew ownership if the old lease expires inside the renewal transaction", async () => {
    const run = await openPersistence(db, runInput, project, 200);
    await admin.query(`CREATE FUNCTION newjitsu.reverse_sync_delay_renew() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.lease_until>OLD.lease_until THEN PERFORM pg_sleep(0.3); END IF; RETURN NEW; END $$;
      CREATE TRIGGER delay_renew BEFORE UPDATE ON newjitsu.reverse_sync_control FOR EACH ROW EXECUTE FUNCTION newjitsu.reverse_sync_delay_renew()`);
    try {
      await expect(renew(db, run.scope)).rejects.toThrow(/ownership/);
    } finally {
      await admin.query(
        "DROP TRIGGER delay_renew ON newjitsu.reverse_sync_control; DROP FUNCTION newjitsu.reverse_sync_delay_renew()"
      );
    }
    expect(
      (await admin.query("SELECT lease_until<clock_timestamp() AS expired FROM newjitsu.reverse_sync_control")).rows[0]
        .expired
    ).toBe(true);
  });
  it("captures run configuration before asynchronous admission work", async () => {
    const opening = openPersistence(db, runInput, project);
    runInput.configRevision = "mutated";
    const run = await opening;
    const stored = (await admin.query("SELECT revision FROM newjitsu.reverse_sync_control")).rows[0];
    expect(stored.revision).toBe("revision");
    expect(run.scope.configRevision).toBe("revision");
  });
  it("reserves key-rotation envelope headroom before delivery", async () => {
    const oldKey = randomBytes(32),
      nextKey = randomBytes(32),
      longId = "b".repeat(64);
    const oldCipher = new Cipher("a", { a: oldKey });
    const projected = effects(project("upsert", { id: "a" }))[0];
    const purpose = db.aad(runInput, `identity:${projected.identityHash}`);
    const oldBytes = oldCipher.seal(projected, purpose, 10000).length;
    const tooSmall = new Database(runtimeConfig, oldCipher, { limits: { snapshotBytes: oldBytes } });
    try {
      const run = await openPersistence(tooSmall, runInput, project);
      await init(run);
      await expect(run.delivery.prepare(batch(run, ["a"]), {})).rejects.toThrow(/reservation budget/);
    } finally {
      await tooSmall.close();
    }
    await expire();
    const capacity = encryptedByteBudget(Buffer.byteLength(JSON.stringify(projected)));
    const oldDb = new Database(runtimeConfig, oldCipher, { limits: { snapshotBytes: capacity } });
    const rotatedDb = new Database(runtimeConfig, new Cipher(longId, { a: oldKey, [longId]: nextKey }), {
      limits: { snapshotBytes: capacity },
    });
    try {
      const run = await openPersistence(oldDb, { ...runInput, taskId: "prepare" }, project);
      const b = batch(run, ["a"]);
      await run.delivery.prepare(b, {});
      await expire();
      const recovered = await openPersistence(rotatedDb, { ...runInput, taskId: "recovery" }, project);
      await recovered.core.acknowledgeRecovered(b.batchId, outcomes(b), {});
      expect(
        Number(
          (await admin.query("SELECT membership_bytes FROM newjitsu.reverse_sync_control")).rows[0].membership_bytes
        )
      ).toBeLessThanOrEqual(capacity);
    } finally {
      await oldDb.close();
      await rotatedDb.close();
    }
  });
  it("persists protocol-maximum finish metadata and combined maximum cursor/store envelopes", async () => {
    const store = { x: "x".repeat(65528) };
    const cursor = { value: "", primaryKeyValues: ["a"] };
    cursor.value = "x".repeat(65536 - Buffer.byteLength(JSON.stringify(cursor)));
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    b.cursor = cursor;
    await run.delivery.prepare(b, store);
    await run.delivery.acknowledge(b.batchId, outcomes(b), store);
    await run.delivery.prepareFinish(1, store);
    const pending = {
      delivery: "pending" as const,
      providerCheckpoint: store,
      remoteJobIds: Array.from({ length: 100 }, () => "\u0000".repeat(512)),
    };
    await run.delivery.acknowledgeFinish(pending, store);
    expect((await run.core.recoveryStatus()).finish).toEqual(pending);
    await run.delivery.acknowledgeFinish({ delivery: "accepted", providerCheckpoint: store }, store);
    await run.delivery.commitCheckpoint({ sourceSequence: 1, cursor }, store, true);
    expect(await count("newjitsu.source_state")).toBe(1);
  });
  it("releases an owner immediately without forgetting prepared init or provider IDs", async () => {
    const run = await session();
    await run.delivery.prepareInit({});
    await run.delivery.saveProviderState({ session: "remote-secret" });
    await release(db, run.scope);
    const next = await session({ taskId: "next" });
    expect(await next.core.recoveryStatus()).toMatchObject({
      phase: "init_prepared",
      providerState: { session: "remote-secret" },
    });
    await expect(next.delivery.assertReady()).rejects.toThrow();
    await expect(run.delivery.acknowledgeInit({})).rejects.toThrow(/ownership/);
    await next.delivery.acknowledgeInit({});
    await next.delivery.prepareAbort();
    await next.delivery.acknowledgeAbort();
  });
  it("resumes local finish resolution after a committed chunk and process loss", async () => {
    const run = await session();
    await init(run);
    const b = batch(
      run,
      Array.from({ length: 105 }, (_, i) => String(i))
    );
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b, "staged"), {});
    await run.delivery.prepareFinish(105, {});
    await admin.query(
      "ALTER TABLE newjitsu.reverse_sync_operation ADD CONSTRAINT interrupt_finish CHECK (sequence<=100 OR status<>'accepted') NOT VALID"
    );
    try {
      await expect(run.delivery.acknowledgeFinish({ delivery: "accepted" }, {})).rejects.toThrow();
    } finally {
      await admin.query("ALTER TABLE newjitsu.reverse_sync_operation DROP CONSTRAINT interrupt_finish");
    }
    expect(await count("newjitsu.reverse_sync_membership")).toBe(100);
    expect((await run.core.recoveryStatus()).phase).toBe("finish_resolving");
    expect(await count("newjitsu.source_state")).toBe(0);
    await db.close();
    db = new Database(runtimeConfig, cipher);
    await expire();
    const recovered = await session({ taskId: "recovery" });
    // Acceptance was recorded before the crash; only local resolution remains.
    await recovered.delivery.acknowledgeFinish({ delivery: "accepted" }, {});
    await recovered.delivery.commitCheckpoint({ sourceSequence: 105, cursor: b.cursor }, {}, true);
    expect(await count("newjitsu.reverse_sync_membership")).toBe(105);
    expect(
      (
        await admin.query(
          "SELECT count(DISTINCT accepted_at) AS n FROM newjitsu.reverse_sync_operation WHERE status='accepted'"
        )
      ).rows[0].n
    ).toBe("1");
  }, 15000);
  it("records reconciliation time without requiring a provider acceptance timestamp", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["a"]);
    await run.delivery.prepare(b, {});
    await run.delivery.markUnknown(b.batchId);
    await expire();
    const recovered = await session({ taskId: "recovery" });
    await expect(recovered.delivery.acknowledge(b.batchId, outcomes(b), {})).rejects.toThrow(/explicit reconciliation/);
    expect((await recovered.core.recoveryBatch(b.batchId)).operations[0]).toMatchObject({
      status: "unknown",
      acceptedAt: null,
    });
    const before = (await admin.query("SELECT clock_timestamp() AS now")).rows[0].now;
    await recovered.core.acknowledgeRecovered(b.batchId, outcomes(b), {});
    const accepted = (await recovered.core.recoveryBatch(b.batchId)).operations[0];
    expect(accepted.status).toBe("accepted");
    expect(+accepted.acceptedAt!).toBeGreaterThanOrEqual(+before);
    await recovered.core.acknowledgeRecovered(b.batchId, outcomes(b), {});
    expect((await recovered.core.recoveryBatch(b.batchId)).operations[0].acceptedAt).toEqual(accepted.acceptedAt);
  });
  it("reserves membership capacity before submission and rolls back rejected snapshot batches", async () => {
    const limited = new Database(runtimeConfig, cipher, { limits: { snapshotEntries: 1 } });
    try {
      const run = await openPersistence(limited, { ...runInput, mode: "mirror", extraction: "full" }, project);
      await init(run);
      await run.snapshots.start();
      await expect(
        run.snapshots.append(
          [
            { key: contentHash(["a"]), identities: project("upsert", { id: "a" }) },
            { key: contentHash(["b"]), identities: project("upsert", { id: "b" }) },
          ],
          1
        )
      ).rejects.toThrow(/budget/);
      expect(await count("newjitsu.reverse_sync_source_key")).toBe(0);
      await expect(run.delivery.prepare(batch(run, ["a", "b"]), {})).rejects.toThrow(/budget/);
      expect(await count("newjitsu.reverse_sync_batch")).toBe(0);
      expect(await count("newjitsu.reverse_sync_operation")).toBe(0);
    } finally {
      await limited.close();
    }
  });
  it("keeps journal accounting exact and prunes only old terminal recovery data", async () => {
    const run = await session();
    await init(run);
    const b = batch(run, ["private@example.com"]);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b), {});
    await finish(run, b);
    await release(db, run.scope);
    await admin.query("UPDATE newjitsu.reverse_sync_batch SET created_at=clock_timestamp()-interval '60 days'");
    const next = await session({ logicalRunId: "next", taskId: "next", extraction: "full" });
    await init(next);
    const current = batch(next, ["b"]);
    await next.delivery.prepare(current, {});
    const removed = await prune(db, next.scope, new Date(Date.now() - 30 * 86400000));
    expect(removed.batches).toBe(1);
    expect(await count("newjitsu.reverse_sync_batch")).toBe(1);
    expect(await count("newjitsu.reverse_sync_membership")).toBe(1);
    const expected = (
      await admin.query(
        "SELECT (SELECT sum(octet_length(manifest)+result_bytes) FROM newjitsu.reverse_sync_batch)+(SELECT sum(octet_length(effects)) FROM newjitsu.reverse_sync_operation) AS bytes"
      )
    ).rows[0].bytes;
    expect((await admin.query("SELECT journal_bytes FROM newjitsu.reverse_sync_control")).rows[0].journal_bytes).toBe(
      expected
    );
    expect((await next.core.recoveryBatch(current.batchId)).operations[0].status).toBe("prepared");
  });
  it("requires the empty cursor run to retain its actual starting checkpoint", async () => {
    const run = await session();
    await init(run);
    await run.delivery.prepareFinish(0, {});
    await run.delivery.acknowledgeFinish({ delivery: "accepted" }, {});
    await expect(
      run.delivery.commitCheckpoint(
        { sourceSequence: 0, cursor: { value: "made-up", primaryKeyValues: ["a"] } },
        {},
        true
      )
    ).rejects.toThrow(/starting cursor/);
    expect(await count("newjitsu.source_state")).toBe(0);
  });
  it("supports encryption-key rotation and rejects tampering", () => {
    const oldKey = randomBytes(32),
      newKey = randomBytes(32);
    const old = new Cipher("old", { old: oldKey });
    const rotated = new Cipher("new", { old: oldKey, new: newKey });
    const encrypted = old.seal({ secret: "value" }, "scope", 100);
    expect(rotated.open(encrypted, "scope")).toEqual({ secret: "value" });
    expect(old.seal({ secret: "value" }, "scope", 100)).not.toEqual(encrypted);
    const damaged = Buffer.from(encrypted);
    damaged[damaged.length - 10] ^= 1;
    expect(() => rotated.open(damaged, "scope")).toThrow(/decrypt/);
  });
});

describe("core snapshot storage", () => {
  async function mirror() {
    const run = await session({ mode: "mirror", extraction: "full" });
    await init(run);
    await run.snapshots.start();
    return run;
  }
  const desired = (key: string, id: string) => ({ key: contentHash([key]), identities: project("upsert", { id }) });
  it("serializes concurrent duplicate page retries and ignores object-key ordering", async () => {
    const run = await mirror();
    const row = desired("key1", "a");
    const reordered = {
      identities: row.identities.map(value => ({
        remove: value.remove,
        upsert: value.upsert,
        identity: value.identity,
      })),
      key: row.key,
    };
    await Promise.all([run.snapshots.append([row], 1), run.snapshots.append([reordered], 1)]);
    expect(await run.snapshots.status()).toEqual({ sealed: false, lastPageSequence: 1, sourceKeyCount: 1 });
    expect(await count("newjitsu.reverse_sync_source_key")).toBe(1);
    expect(await count("newjitsu.reverse_sync_desired")).toBe(1);
    expect((await admin.query("SELECT entry_count FROM newjitsu.reverse_sync_generation")).rows[0].entry_count).toBe(
      "1"
    );
  });
  it("keeps abandoned generation and stale-owner guards on retryable snapshot APIs", async () => {
    const first = await mirror();
    await first.snapshots.append([desired("key1", "a")], 1);
    await first.delivery.prepareAbort();
    await first.delivery.acknowledgeAbort();
    await release(db, first.scope);
    const next = await session({ mode: "mirror", extraction: "full", taskId: "next", logicalRunId: "next" });
    await init(next);
    expect(await next.snapshots.status()).toBeUndefined();
    await expect(next.snapshots.start()).rejects.toThrow(/Prune abandoned/);
    await expect(first.snapshots.start()).rejects.toThrow(/ownership/);
    await expect(first.snapshots.append([desired("key1", "a")], 1)).rejects.toThrow(/ownership/);
    await expect(first.snapshots.status()).rejects.toThrow(/ownership/);
    await prune(db, next.scope, new Date(Date.now() - 30 * 86400000));
    await next.snapshots.start();
    expect(await next.snapshots.status()).toEqual({ sealed: false, lastPageSequence: 0, sourceKeyCount: 0 });
  });
  it("rolls back a snapshot page and its receipt together, then permits retry after takeover", async () => {
    const run = await mirror();
    const rows = [desired("key1", "a")];
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(run.snapshots.append(rows, sequence)).rejects.toThrow(/sequence/);
    }
    await expect(run.snapshots.append([rows[0], rows[0]], 1)).rejects.toThrow();
    await admin.query(
      "ALTER TABLE newjitsu.reverse_sync_generation ADD CONSTRAINT injected_page_failure CHECK (key_count = 0) NOT VALID"
    );
    try {
      await expect(run.snapshots.append(rows, 1)).rejects.toThrow();
    } finally {
      await admin.query("ALTER TABLE newjitsu.reverse_sync_generation DROP CONSTRAINT injected_page_failure");
    }
    expect(await run.snapshots.status()).toEqual({ sealed: false, lastPageSequence: 0, sourceKeyCount: 0 });
    expect(await count("newjitsu.reverse_sync_desired")).toBe(0);
    expect(await count("newjitsu.reverse_sync_source_key")).toBe(0);
    expect(
      (await admin.query("SELECT last_page_hash FROM newjitsu.reverse_sync_generation")).rows[0].last_page_hash
    ).toBeNull();
    await release(db, run.scope);
    const recovered = await session({ mode: "mirror", extraction: "full", taskId: "recovery" });
    await recovered.snapshots.start();
    await recovered.snapshots.append(rows, 1);
    expect(await recovered.snapshots.status()).toEqual({ sealed: false, lastPageSequence: 1, sourceKeyCount: 1 });
  });
  it.each([false, true])("retries snapshot creation after takeover (committed=%s)", async committed => {
    const run = await session({ mode: "mirror", extraction: "full" });
    await init(run);
    if (committed) await run.snapshots.start();
    await release(db, run.scope);
    const recovered = await session({ mode: "mirror", extraction: "full", taskId: "recovery" });
    await recovered.snapshots.start();
    await recovered.snapshots.start();
    expect(await count("newjitsu.reverse_sync_generation")).toBe(1);
    await recovered.snapshots.append([desired("key1", "a")], 1);
    await recovered.snapshots.start();
    expect(await count("newjitsu.reverse_sync_source_key")).toBe(1);
  });
  it.each([false, true])("retries the last snapshot page without changing data (recovery=%s)", async recovery => {
    const run = await mirror();
    const rows = [desired("key1", "a"), desired("key2", "a")];
    await run.snapshots.append(rows, 1);
    let active = run;
    let recoveredDb: Database | undefined;
    try {
      if (recovery) {
        await release(db, run.scope);
        recoveredDb = new Database(runtimeConfig, cipher);
        active = await openPersistence(
          recoveredDb,
          { ...runInput, mode: "mirror", extraction: "full", taskId: "recovery" },
          project
        );
      }
      const snapshot = async () => ({
        generation: (await admin.query("SELECT * FROM newjitsu.reverse_sync_generation")).rows,
        keys: (await admin.query("SELECT * FROM newjitsu.reverse_sync_source_key ORDER BY key_hash")).rows,
        desired: (await admin.query("SELECT * FROM newjitsu.reverse_sync_desired ORDER BY identity_hash")).rows,
      });
      const before = await snapshot();
      await active.snapshots.append(rows, 1);
      expect(await snapshot()).toEqual(before);
      for (const changed of [
        [desired("key1", "different"), rows[1]],
        [rows[0]],
        [rows[1], rows[0]],
        [rows[0], { ...rows[1], identities: [{ ...rows[1].identities[0], remove: { id: "different" } }] }],
      ]) {
        await expect(active.snapshots.append(changed, 1)).rejects.toThrow(/Snapshot page retry differs/);
        expect(await snapshot()).toEqual(before);
      }
      await expect(active.snapshots.append([desired("key3", "b")], 3)).rejects.toThrow(/sequence/);
      // A duplicate source row in a NEW page must still fail, even with identical payload.
      await expect(active.snapshots.append([desired("key3", "b"), rows[0]], 2)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
      await active.snapshots.append([desired("key3", "a")], 2);
      await active.snapshots.append([desired("key3", "a")], 2);
      await expect(active.snapshots.append(rows, 1)).rejects.toThrow(/sequence/);
      expect(await active.snapshots.status()).toEqual({ sealed: false, lastPageSequence: 2, sourceKeyCount: 3 });
      expect(await count("newjitsu.reverse_sync_desired")).toBe(1);
      await active.snapshots.seal();
      await active.snapshots.seal();
      expect(await active.snapshots.status()).toEqual({ sealed: true, lastPageSequence: 2, sourceKeyCount: 3 });
      await expect(active.snapshots.start()).rejects.toThrow(/sealed/);
      await expect(active.snapshots.append([desired("key3", "a")], 2)).rejects.toThrow(/sealed/);
    } finally {
      await recoveredDb?.close();
    }
  });
  it("separately validates source keys and shared identities, with rollback on conflicting payloads", async () => {
    const run = await mirror();
    await run.snapshots.append([desired("key1", "shared"), desired("key2", "shared")], 1);
    expect(await count("newjitsu.reverse_sync_desired")).toBe(1);
    expect(await count("newjitsu.reverse_sync_source_key")).toBe(2);
    const size = (await admin.query("SELECT sum(octet_length(value)) AS n FROM newjitsu.reverse_sync_desired")).rows[0]
      .n;
    const accounting = (
      await admin.query("SELECT key_count,entry_count,byte_count FROM newjitsu.reverse_sync_generation")
    ).rows[0];
    expect(accounting).toEqual({ key_count: "2", entry_count: "2", byte_count: String(Number(size) + 2 * 64) });
    await expect(run.snapshots.append([desired("key1", "different")], 2)).rejects.toThrow();
    await expect(
      run.snapshots.append(
        [
          {
            key: contentHash(["key3"]),
            identities: [{ identity: "shared", upsert: { id: "conflict" }, remove: { id: "shared" } }],
          },
        ],
        2
      )
    ).rejects.toThrow(/Conflicting/);
    expect(await count("newjitsu.reverse_sync_source_key")).toBe(2);
    expect(
      (await admin.query("SELECT key_count,entry_count,byte_count FROM newjitsu.reverse_sync_generation")).rows[0]
    ).toEqual(accounting);
  });
  it("keeps a shared identity until its last source row disappears from a full snapshot", async () => {
    const first = await mirror();
    await first.snapshots.append([desired("key1", "shared"), desired("key2", "shared")], 1);
    await first.snapshots.seal();
    const addition = batch(first, ["shared"], 1, "upsert", false);
    await first.delivery.prepare(addition, {});
    await first.delivery.acknowledge(addition.batchId, outcomes(addition), {});
    await finish(first, addition);
    await release(db, first.scope);

    const second = await session({ mode: "mirror", extraction: "full", taskId: "second", logicalRunId: "second" });
    await init(second);
    await second.snapshots.start();
    await second.snapshots.append([desired("key2", "shared")], 1);
    await second.snapshots.seal();
    expect(await second.snapshots.page("additions")).toEqual([]);
    expect(await second.snapshots.page("removals")).toEqual([]);
    await finish(second);
    await release(db, second.scope);

    const third = await session({ mode: "mirror", extraction: "full", taskId: "third", logicalRunId: "third" });
    await init(third);
    await prune(db, third.scope, new Date(Date.now() - 30 * 86400000));
    expect(
      (await admin.query("SELECT generation FROM newjitsu.reverse_sync_generation ORDER BY generation")).rows
    ).toEqual([{ generation: "second" }]);
    await third.snapshots.start();
    await third.snapshots.seal();
    expect((await third.snapshots.page("removals")).map(row => row.remove)).toEqual([{ id: "shared" }]);
    const removal = batch(third, ["shared"], 1, "remove", false);
    await third.delivery.prepare(removal, {});
    await third.delivery.acknowledge(removal.batchId, outcomes(removal), {});
    await finish(third, removal);
    expect(await count("newjitsu.reverse_sync_membership")).toBe(0);
  });
  it("requires sealed full source and accepted additions before any removal", async () => {
    const run = await mirror();
    await run.snapshots.append([desired("key1", "a")], 1);
    await expect(run.snapshots.page("removals")).rejects.toThrow(/sealed/);
    await run.snapshots.seal();
    await expect(run.snapshots.page("removals")).rejects.toThrow(/accepted/);
    const b = batch(run, ["a"], 1, "upsert", false);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b, "staged"), {});
    await expect(run.snapshots.page("removals")).rejects.toThrow(/Unaccepted/);
    await expect(run.delivery.prepareFinish(1, {})).rejects.toThrow();
  });
  it("retains failed-run additions and promotes an empty later snapshot only after accepted removal", async () => {
    const first = await mirror();
    const b = batch(first, ["a"], 1, "upsert", false);
    await first.delivery.prepare(b, {});
    await first.delivery.acknowledge(b.batchId, outcomes(b), {});
    await first.delivery.prepareAbort();
    await first.delivery.acknowledgeAbort();
    await expire();
    const next = await session({ mode: "mirror", extraction: "full", taskId: "next", logicalRunId: "next" });
    await init(next);
    await prune(db, next.scope, new Date(Date.now() - 30 * 86400000));
    await next.snapshots.start();
    await next.snapshots.seal();
    expect((await next.snapshots.page("removals"))[0].remove).toEqual({ id: "a" });
    await expect(next.delivery.prepareFinish(0, {})).rejects.toThrow(/Unremoved/);
    const removal = batch(next, ["a"], 1, "remove", false);
    await next.delivery.prepare(removal, {});
    await next.delivery.acknowledge(removal.batchId, outcomes(removal), {});
    await finish(next, removal);
    expect(
      (await admin.query("SELECT committed_generation FROM newjitsu.reverse_sync_control")).rows[0].committed_generation
    ).toBe("next");
    expect(await count("newjitsu.reverse_sync_membership")).toBe(0);
  });
  it("keeps shared desired identities and paginates additions by identity hash", async () => {
    const run = await mirror();
    await run.snapshots.append([desired("key1", "a"), desired("key2", "a"), desired("key3", "b")], 1);
    await run.snapshots.seal();
    const page = await run.snapshots.page("additions", "", 1);
    const second = await run.snapshots.page("additions", page[0].identityHash, 1);
    expect(page[0].identityHash).not.toBe(second[0].identityHash);
    expect(await run.snapshots.page("additions", second[0].identityHash, 1)).toEqual([]);
    const b = batch(run, ["a", "b"], 1, "upsert", false);
    await run.delivery.prepare(b, {});
    await run.delivery.acknowledge(b.batchId, outcomes(b), {});
    expect(await run.snapshots.page("additions")).toEqual([]);
    expect(await run.snapshots.page("removals")).toEqual([]);
    await expect(run.delivery.prepare(batch(run, ["a"], 3, "remove", false), {})).rejects.toThrow(/shared identity/);
    await finish(run, b);
  });
  it("guards exclusive audience ownership across workspaces and lease expiry", async () => {
    await mirror();
    await expire();
    await expect(
      session({ workspaceId: "other", syncId: "other", mode: "mirror", extraction: "full" })
    ).rejects.toThrow(/another mirror/);
    await expect(session({ workspaceId: "other", syncId: "other" })).rejects.toThrow(/exclusively/);
  });
});
