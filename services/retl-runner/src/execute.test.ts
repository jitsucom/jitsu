import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { Client } from "pg";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { ReverseEtlContext, JsonObject, WriteBatch } from "@jitsu/protocols/reverse-etl";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { Database } from "./persistence";
import { execute, type ExecuteOptions } from "./execute";
import type { RuntimeAdapter } from "./adapters";
import { Tasks } from "./tasks";

let container: StartedTestContainer;
let admin: Client;
let db: Database;
beforeAll(async () => {
  container = await new GenericContainer("postgres:18-alpine")
    .withEnvironment({ POSTGRES_PASSWORD: "test", POSTGRES_DB: "runner_test" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const config = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: "runner_test",
    user: "postgres",
    password: "test",
  };
  admin = new Client(config);
  await admin.connect();
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
      env: {
        // eslint-disable-next-line no-restricted-properties -- disposable test database only.
        ...process.env,
        DATABASE_URL: `postgresql://postgres:test@${config.host}:${config.port}/${config.database}?schema=newjitsu`,
      },
      stdio: "inherit",
    }
  );
  await admin.query(
    "CREATE ROLE runner_runtime LOGIN PASSWORD 'runtime'; GRANT USAGE ON SCHEMA newjitsu TO runner_runtime"
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
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON newjitsu.reverse_sync_${table} TO runner_runtime`);
  await admin.query(
    "GRANT SELECT,INSERT,UPDATE ON newjitsu.source_state,newjitsu.source_task TO runner_runtime; GRANT INSERT ON newjitsu.task_log TO runner_runtime"
  );
  db = new Database({ ...config, user: "runner_runtime", password: "runtime" });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await admin?.end();
  await container?.stop();
});
beforeEach(async () => {
  await admin.query(
    "TRUNCATE newjitsu.reverse_sync_operation,newjitsu.reverse_sync_batch,newjitsu.reverse_sync_control,newjitsu.reverse_sync_target_owner,newjitsu.reverse_sync_generation,newjitsu.reverse_sync_source_key,newjitsu.reverse_sync_desired,newjitsu.reverse_sync_membership,newjitsu.source_state,newjitsu.source_task,newjitsu.task_log"
  );
});
const config = () =>
  ReverseRunConfig.parse({
    version: 1,
    kind: "reverse",
    id: "sync",
    workspaceId: "workspace",
    fromId: "model",
    toId: "destination",
    configRevision: "a".repeat(64),
    updatedAt: new Date().toISOString(),
    model: { warehouseId: "warehouse", query: "SELECT id FROM users", primaryKey: ["id"] },
    warehouse: { destinationType: "postgres" },
    destination: { destinationType: "test" },
    options: { stream: "audience", mode: "upsert", mapping: { id: "id" } },
  });
const accepted = (batch: WriteBatch<JsonObject>) => ({
  outcomes: batch.records.map(row => ({ operationId: row.operationId, status: "accepted" as const })),
});
function fixture() {
  const calls: string[] = [];
  const writes: WriteBatch<JsonObject>[] = [];
  let pending = false;
  let failInit = false;
  let failBatch = false;
  let rows = [{ id: "a" }, { id: "b" }];
  const writer = (ctx: ReverseEtlContext<JsonObject, JsonObject>) => ({
    init: async () => {
      calls.push("init");
      if (failInit) throw new Error("private-token");
      await ctx.delivery.saveProviderState({ session: "existing" });
    },
    upsert: async (batch: WriteBatch<JsonObject>) => {
      calls.push("upsert");
      writes.push(batch);
      if (failBatch) throw new Error("lost-response");
      return accepted(batch);
    },
    remove: async (batch: WriteBatch<JsonObject>) => {
      calls.push("remove");
      return accepted(batch);
    },
    finish: async () => {
      calls.push("finish");
      return pending ? { delivery: "pending" as const, remoteJobIds: ["job"] } : { delivery: "accepted" as const };
    },
    abort: async () => {
      calls.push("abort");
    },
  });
  const adapter: RuntimeAdapter = {
    credentials: {},
    targetIdentity: "test/account/audience",
    project: (_action, row: any) => [{ identity: String(row.id), upsert: { id: row.id }, remove: { id: row.id } }],
    stream: {
      name: "audience",
      displayName: "Audience",
      rowType: z.object({ id: z.string() }),
      removeRowType: z.object({ id: z.string() }),
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
    verifyMirrorBaseline: async () => "tracked",
    recovery: () => ({
      attachWriter: async ctx => {
        calls.push("attach");
        return writer(ctx);
      },
      reconcileBatch: async batch => {
        calls.push("reconcile");
        expect(batch).toEqual(writes.at(-1));
        return accepted(batch);
      },
      reconcileFinish: async () => {
        calls.push("reconcileFinish");
        return { delivery: "accepted" };
      },
      reconcileInit: async () => {
        calls.push("reconcileInit");
        return "absent";
      },
      reconcileAbort: async () => {
        calls.push("reconcileAbort");
      },
    }),
  };
  adapter.mirror = {
    stream: adapter.stream,
    batchDelivery: "accepted",
    projection: { rowType: adapter.stream.rowType, project: row => adapter.project("upsert", row) },
  };
  const input: ExecuteOptions = {
    config: config(),
    db,
    taskId: "task",
    trigger: "scheduled",
    adapters: new Map([["test", () => adapter]]),
    controller: new AbortController(),
    lease: {
      acquire: async () => {
        calls.push("lease");
      },
      renew: async () => {
        calls.push("renew");
      },
      release: async () => {
        calls.push("release");
      },
    },
    admit: async () => input.config,
    reader: () => {
      calls.push("reader");
      return {
        sql: {} as any,
        columns: async () => [],
        preview: async () => ({ rows: [], columns: [], truncated: false }),
        close: async () => {
          calls.push("close");
        },
        stream: async function* (_model, after, signal) {
          calls.push("source");
          expect(signal).toBe(input.controller.signal);
          for (const row of rows)
            yield {
              row,
              deleted: false,
              ...(input.config.model.cursor ? { checkpoint: { value: row.id, primaryKeyValues: [row.id] } } : {}),
            };
        },
      };
    },
  };
  return {
    input,
    calls,
    adapter,
    writes,
    setPending: () => {
      pending = true;
    },
    setFailInit: () => {
      failInit = true;
    },
    setFailBatch: () => {
      failBatch = true;
    },
    setRows: (value: typeof rows) => {
      rows = value;
    },
  };
}
async function task(id = "task") {
  return (await admin.query("SELECT * FROM newjitsu.source_task WHERE task_id=$1", [id])).rows[0];
}
async function control() {
  return (await admin.query("SELECT * FROM newjitsu.reverse_sync_control")).rows[0];
}

describe("executable runner", () => {
  it("does not open persistence or start a task when Kubernetes admission is denied", async () => {
    const f = fixture();
    f.input.lease.acquire = async () => {
      throw new Error("Another worker holds the lease");
    };
    expect(await execute(f.input)).toBe("FAILED");
    expect(await control()).toBeUndefined();
    expect(await task()).toBeUndefined();
    expect(f.calls).toEqual([]);
  });
  it("runs upsert with restricted DB grants, task logs and Kubernetes admission", async () => {
    const f = fixture();
    expect(await execute(f.input)).toBe("SUCCESS");
    expect((await task()).status).toBe("SUCCESS");
    expect((await control()).phase).toBe("complete");
    expect(f.calls).toEqual([
      "lease",
      "renew",
      "create",
      "init",
      "reader",
      "source",
      "upsert",
      "finish",
      "close",
      "release",
    ]);
    expect((await admin.query("SELECT message FROM newjitsu.task_log")).rows).toContainEqual({
      message: "Reverse ETL delivery committed",
    });
  });
  it("runs mirror including empty generations", async () => {
    const f = fixture();
    f.input.config.options.mode = "mirror";
    expect(await execute(f.input)).toBe("SUCCESS");
    f.input.taskId = "empty";
    f.setRows([]);
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("SUCCESS");
    expect(f.calls).toContain("remove");
    expect((await admin.query("SELECT count(*) FROM newjitsu.reverse_sync_membership")).rows[0].count).toBe("0");
  });
  it("caps provider batches to the journal record budget", async () => {
    const f = fixture();
    const bounded = new Database(
      {
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: "runner_test",
        user: "runner_runtime",
        password: "runtime",
      },
      { limits: { batchRecords: 2 } }
    );
    f.input.db = bounded;
    f.adapter.stream.batchSize = 1000;
    f.setRows([{ id: "a" }, { id: "b" }, { id: "c" }]);
    try {
      expect(await execute(f.input)).toBe("SUCCESS");
      expect(f.writes.map(batch => batch.records.length)).toEqual([2, 1]);
    } finally {
      await bounded.close();
    }
  });
  it("rejects stale admission before constructing provider or reader", async () => {
    const f = fixture();
    f.input.admit = async () => ({ ...f.input.config, configRevision: "b".repeat(64) });
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).toEqual(["lease", "release"]);
    expect((await task()).status).toBe("FAILED");
  });
  it("does not admit missing provider bindings", async () => {
    const f = fixture();
    f.input.adapters = new Map();
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).not.toContain("reader");
  });
  it("does not overwrite a task cancelled before startup", async () => {
    const f = fixture();
    await new Tasks(db, "sync", "task").start("manual");
    await new Tasks(db, "sync", "task").finish("CANCELLED", "Cancelled");
    expect(await execute(f.input)).toBe("FAILED");
    expect((await task()).status).toBe("CANCELLED");
    expect(f.calls).toEqual(["lease", "release"]);
  });
  it("reconciles pending finish without a fresh source or session", async () => {
    const f = fixture();
    f.setPending();
    expect(await execute(f.input)).toBe("FAILED");
    const logical = (await control()).run_id;
    f.input.taskId = "recovery";
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("SUCCESS");
    expect(f.calls).toEqual(["lease", "renew", "reconcileFinish", "release"]);
    expect((await control()).run_id).toBe(logical);
    expect((await task()).status).toBe("FAILED");
  });
  it("preserves cursor when recovered finish commits the exact last manifest", async () => {
    const f = fixture();
    f.input.config.model.cursor = { column: "id", type: "string" };
    f.setPending();
    expect(await execute(f.input)).toBe("FAILED");
    f.input.taskId = "recovery";
    expect(await execute(f.input)).toBe("SUCCESS");
    expect((await control()).checkpoint_sequence).toBe("2");
  });
  it("recovers an empty cursor run from its plain JSON checkpoint without keys", async () => {
    const f = fixture();
    f.input.config.model.cursor = { column: "id", type: "string" };
    f.setRows([{ id: "a\u0000b" }]);
    expect(await execute(f.input)).toBe("SUCCESS");
    const saved = (await admin.query("SELECT state FROM newjitsu.source_state")).rows[0].state;
    expect(saved.version).toBe(2);
    const point = JSON.parse(saved.value).value.point;
    expect(point.cursor).toEqual({ value: "a\u0000b", primaryKeyValues: ["a\u0000b"] });

    f.setRows([]);
    f.setPending();
    f.input.taskId = "empty";
    expect(await execute(f.input)).toBe("FAILED");
    f.input.taskId = "recovery";
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("SUCCESS");
    expect(f.calls).toEqual(["lease", "renew", "reconcileFinish", "release"]);
    const recovered = (await admin.query("SELECT state FROM newjitsu.source_state")).rows[0].state;
    expect(JSON.parse(recovered.value).value.point).toEqual(point);
  });
  it("blocks unknown initialization without proof, then resets with explicit reconciliation", async () => {
    const f = fixture();
    f.setFailInit();
    expect(await execute(f.input)).toBe("FAILED");
    const recovery = f.adapter.recovery;
    f.adapter.recovery = undefined;
    f.input.taskId = "blocked";
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).toEqual(["lease", "renew", "release"]);
    expect((await control()).phase).toBe("init_prepared");
    f.adapter.recovery = recovery;
    f.input.taskId = "reset";
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).toContain("reconcileInit");
    expect((await control()).phase).toBe("new");
  });
  it("reconciles an ambiguous upsert then cleans up before any fresh extraction", async () => {
    const f = fixture();
    f.setFailBatch();
    expect(await execute(f.input)).toBe("FAILED");
    f.input.taskId = "recovery";
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).toEqual(["lease", "renew", "reconcile", "reconcileAbort", "release"]);
    expect((await control()).phase).toBe("aborted");
    expect((await admin.query("SELECT count(*) FROM newjitsu.reverse_sync_membership")).rows[0].count).toBe("2");
  });
  it("does not release ownership until an aborted in-flight callback settles", async () => {
    const f = fixture();
    f.input.heartbeatMs = 5;
    let unblock!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => {
      entered = resolve;
    });
    const barrier = new Promise<void>(resolve => {
      unblock = resolve;
    });
    const create = f.adapter.stream.createWriter;
    f.adapter.stream.createWriter = async ctx => {
      const writer = await create(ctx);
      return {
        ...writer,
        upsert: async batch => {
          entered();
          await barrier;
          return accepted(batch);
        },
      };
    };
    const running = execute(f.input);
    await enteredPromise;
    f.input.controller.abort();
    expect(f.calls).not.toContain("release");
    expect((await task()).status).toBe("RUNNING");
    unblock();
    expect(await running).toBe("CANCELLED");
    expect(f.calls.at(-1)).toBe("release");
  });
  it("aborts a live run when Kubernetes renewal fails", async () => {
    const f = fixture();
    f.input.heartbeatMs = 5;
    let constructing = false;
    f.input.lease.renew = async () => {
      if (constructing) throw new Error("lease lost");
    };
    const create = f.adapter.stream.createWriter;
    f.adapter.stream.createWriter = async ctx => {
      constructing = true;
      await new Promise<void>(resolve => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
      return create(ctx);
    };
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).not.toContain("init");
    expect((await control()).phase).toBe("init_prepared");
    expect((await task()).error).toContain("ownership");
  });
});
