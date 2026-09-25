import { afterEach, beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { Client } from "pg";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { BatchResult, ReverseEtlContext, JsonObject, WriteBatch } from "@jitsu/protocols/reverse-etl";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { Database, openPersistence } from "./persistence";
import { execute, type ExecuteOptions } from "./execute";
import type { RuntimeAdapter } from "./adapters";
import { createAdapterRegistry } from "./adapters";
import { Tasks } from "./tasks";
import { googleAudienceStateStream } from "@jitsu/destination-functions/src/functions/google-ads/audience/state";
import { ReverseEtlManualReconciliationError } from "@jitsu/destination-functions/src/reverse-etl/failure";
import { recordKey } from "@jitsu/destination-functions/src/reverse-etl/identity";

import { MemoryObjects, persisted } from "./artifacts/test-support";
const objects = new MemoryObjects();
const storage = { objectStorage: { store: objects, signal: new AbortController().signal } };
const durable = () => persisted(admin, objects);
afterEach(() => vi.useRealTimers());

describe("Meta Reverse ETL runner integration", () => {
  const metaResponse = (body: unknown) =>
    new Response(JSON.stringify(body)) as Awaited<ReturnType<typeof globalThis.fetch>>;
  it.each([false, true])(
    "provisions once and mirrors snapshots with additions before removals (lost receipt: %s)",
    async lostReceipt => {
      const f = fixture();
      f.input.config.destination = { destinationType: "facebook-conversions", accessToken: "meta-token" };
      f.input.config.model.cursor = undefined;
      f.input.config.options = {
        ...f.input.config.options,
        stream: "audience",
        mode: "mirror",
        mapping: { email: "id" },
        streamOptions: {
          accountId: "123",
          audience: { kind: "managed", name: "Test" },
          exclusiveManagementConfirmed: true,
        },
      };
      const token = vi.fn(async () => "unused-oauth");
      f.input.adapters = createAdapterRegistry(token);
      let marker = "";
      let loseResponse = lostReceipt;
      let lastSession: { session_id: string; num_received: number; num_invalid_entries: number } | undefined;
      const calls: { method: string; payload?: any }[] = [];
      const wire = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        const method = init!.method!;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (String(url).includes("/customaudiences") && method === "POST") {
          marker = body.description;
          calls.push({ method: "create" });
          return metaResponse({ id: "456" });
        }
        if (String(url).includes("/456/users")) {
          calls.push({ method, payload: body.payload });
          lastSession = {
            session_id: String(body.session.session_id),
            num_received: body.payload.data.length,
            num_invalid_entries: 0,
          };
          if (loseResponse) {
            loseResponse = false;
            throw new Error("Response lost after ingestion");
          }
          return metaResponse({ audience_id: "456", ...lastSession });
        }
        if (String(url).includes("/456/sessions")) {
          expect(String(url)).toContain(`session_id=${lastSession!.session_id}`);
          return metaResponse({ data: [lastSession] });
        }
        return metaResponse({
          id: "456",
          account_id: "123",
          subtype: "CUSTOM",
          is_value_based: false,
          description: marker,
        });
      });
      try {
        f.setRows([{ id: "a@example.com" }, { id: "b@example.com" }]);
        expect(await execute(f.input)).toBe(lostReceipt ? "FAILED" : "COMPLETE");
        if (lostReceipt) {
          f.input.taskId = "meta-resume";
          f.calls.length = 0;
          expect(await execute(f.input)).toBe("COMPLETE");
          expect(f.calls).not.toContain("reader");
        }
        f.input.taskId = "meta-second";
        f.setRows([{ id: "b@example.com" }, { id: "c@example.com" }]);
        expect(await execute(f.input)).toBe("COMPLETE");
        expect(calls.map(c => c.method)).toEqual(["create", "POST", "POST", "DELETE"]);
        expect(calls.slice(1).map(c => c.payload.data.length)).toEqual([2, 1, 1]);
        f.input.taskId = "meta-empty";
        f.setRows([]);
        expect(await execute(f.input)).toBe("COMPLETE");
        expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
        expect(calls.at(-1)!.payload.data).toHaveLength(2);
        expect((await durable()).members).toHaveLength(0);
        expect(token).not.toHaveBeenCalled();
      } finally {
        wire.mockRestore();
      }
    }
  );
  it("deduplicates Meta conversion source keys across runs without audience state or OAuth", async () => {
    const f = fixture();
    f.input.config.destination = { destinationType: "facebook-conversions", accessToken: "meta-token" };
    f.input.config.model.cursor = undefined;
    f.input.config.options = {
      ...f.input.config.options,
      stream: "conversions",
      mode: "upsert",
      mapping: { email: "id" },
      streamOptions: { pixelId: "789", actionSource: "physical_store", eventName: "Lead" },
    };
    const token = vi.fn(async () => "unused-oauth");
    f.input.adapters = createAdapterRegistry(token);
    const uploads: any[][] = [];
    const wire = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://graph.facebook.com/v26.0/789/events");
      const body = JSON.parse(String(init!.body));
      uploads.push(body.data);
      return metaResponse({ events_received: body.data.length });
    });
    try {
      f.setRows([{ id: "a@example.com" }, { id: "b@example.com" }]);
      expect(await execute(f.input)).toBe("COMPLETE");
      f.input.taskId = "meta-conversions-next";
      f.setRows([{ id: "a@example.com" }, { id: "b@example.com" }, { id: "c@example.com" }]);
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(uploads.map(batch => batch.length)).toEqual([2, 1]);
      expect(token).not.toHaveBeenCalled();
      expect(
        (await admin.query("SELECT count(*) FROM newjitsu.source_state WHERE stream='_REVERSE_ETL_META_AUDIENCE_' "))
          .rows[0].count
      ).toBe("0");
    } finally {
      wire.mockRestore();
    }
  });
});

describe("runner-owned Google audience provisioning", () => {
  it("does not persist an impossible mobile audience creation intent", async () => {
    const f = fixture();
    f.input.config.destination = {
      destinationType: "google-ads",
      authorized: true,
      oauthConnectionId: "destination.destination",
      customerId: "1234567890",
    };
    f.input.config.options = {
      ...f.input.config.options,
      mode: "mirror",
      stream: "audience",
      mapping: { mobileAdvertisingId: "id" },
      streamOptions: {
        audience: { kind: "managed", displayName: "Mobile" },
        identifierType: "MOBILE_ADVERTISING_ID",
        customerMatchTermsAccepted: true,
        exclusiveManagementConfirmed: true,
      },
    };
    f.input.adapters = createAdapterRegistry(async () => "token");
    expect(await execute(f.input)).toBe("FAILED");
    expect((await task()).error).toContain("Set the App ID and mobile platform");
    expect(
      (await admin.query("SELECT count(*) FROM newjitsu.source_state WHERE stream=$1", [googleAudienceStateStream]))
        .rows[0].count
    ).toBe("0");
    expect((await admin.query("SELECT count(*) FROM newjitsu.reverse_sync_control")).rows[0].count).toBe("0");
    expect(f.calls).not.toContain("reader");
  });
  it("stops polling terminal ambiguous conversion results without reopening the model", async () => {
    const f = asynchronousFixture();
    expect(await execute(f.input)).toBe("PENDING");
    const bind = f.adapter.recovery!;
    f.adapter.recovery = state => ({
      ...bind(state),
      reconcileBatch: async () => {
        throw new ReverseEtlManualReconciliationError();
      },
    });
    await admin.query(
      `UPDATE newjitsu.source_task SET metrics=jsonb_set(metrics,'{reverseRecovery,nextCheckAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE status='PENDING'`
    );
    f.input = { ...f.input, taskId: "terminal-check", recoveryOf: "task", trigger: "recovery" };
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("FAILED");
    expect((await task()).error).toContain("partial or unverified conversion results");
    expect(f.calls).not.toContain("reader");
  });
  it.each(["click-conversions", "call-conversions", "conversion-adjustments"])(
    "runs %s and skips previously submitted primary keys on subsequent extraction",
    async stream => {
      const f = fixture();
      f.input.config.destination = {
        destinationType: "google-ads",
        authorized: true,
        oauthConnectionId: "destination.destination",
        customerId: "1234567890",
        developerToken: "test-token",
      };
      f.input.config.model.cursor = undefined;
      f.input.config.options = {
        ...f.input.config.options,
        mode: "upsert",
        stream,
        mapping:
          stream === "click-conversions"
            ? { gclid: "id", conversionTimestamp: "time" }
            : stream === "call-conversions"
            ? { callerId: "caller", callTimestamp: "time", conversionTimestamp: "time" }
            : { orderId: "id", adjustmentTimestamp: "time" },
        streamOptions: {
          conversionActionId: "123",
          ...(stream === "conversion-adjustments" ? { adjustmentType: "RETRACTION" } : {}),
        },
      };
      f.input.adapters = createAdapterRegistry(async () => "token");
      const rows = (ids: string[]) => ids.map(id => ({ id, time: "2026-09-20T12:30:00Z", caller: "+14155552671" }));
      f.setRows(rows(["a", "b"]));
      const uploads: any[] = [];
      const wire = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        if (String(_url).includes("requestStatus:retrieve"))
          return new Response(
            JSON.stringify({
              requestStatusPerDestination: [
                {
                  destination: {
                    operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
                    productDestinationId: "123",
                  },
                  requestStatus: "SUCCESS",
                  eventsIngestionStatus: { recordCount: "2" },
                },
              ],
            })
          ) as Awaited<ReturnType<typeof globalThis.fetch>>;
        const body = JSON.parse(init!.body as string);
        uploads.push(body);
        return new Response(
          JSON.stringify(
            stream === "click-conversions"
              ? { requestId: `req-${uploads.length}` }
              : {
                  results: (body.conversions ?? body.conversionAdjustments).map(() => ({
                    conversionAction: "customers/1234567890/conversionActions/123",
                  })),
                }
          )
        ) as Awaited<ReturnType<typeof globalThis.fetch>>;
      });
      try {
        expect(await execute(f.input)).toBe(stream === "click-conversions" ? "PENDING" : "COMPLETE");
        if (stream === "click-conversions") {
          await admin.query(
            `UPDATE newjitsu.source_task SET metrics=jsonb_set(metrics,'{reverseRecovery,nextCheckAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE task_id='task'`
          );
          expect(await execute({ ...f.input, taskId: "accepted-check", trigger: "recovery", recoveryOf: "task" })).toBe(
            "COMPLETE"
          );
        }
        f.input.taskId = "second-event-run";
        // Different payload, same primary key: insert-only must still omit a/b.
        f.setRows(rows(["a", "b", "c"]).map(row => ({ ...row, time: "2026-09-20T13:30:00Z" })));
        expect(await execute(f.input)).toBe(stream === "click-conversions" ? "PENDING" : "COMPLETE");
        expect(uploads).toHaveLength(2);
        const key =
          stream === "click-conversions"
            ? "events"
            : stream === "call-conversions"
            ? "conversions"
            : "conversionAdjustments";
        expect(uploads[0][key]).toHaveLength(2);
        expect(uploads[1][key]).toHaveLength(1);
        expect(await taskLogs("second-event-run")).toContain("2 previously submitted events omitted");
        expect(
          (await admin.query("SELECT count(*) FROM newjitsu.source_state WHERE stream=$1", [googleAudienceStateStream]))
            .rows[0].count
        ).toBe("0");
      } finally {
        wire.mockRestore();
      }
    }
  );
  it.each(["normal", "lost-response", "empty-discovery", "oauth-failure"])(
    "persists first-run provisioning and does not create twice: %s",
    async scenario => {
      const f = fixture();
      f.input.config.destination = {
        destinationType: "google-ads",
        authorized: true,
        oauthConnectionId: "destination.destination",
        customerId: "1234567890",
      };
      f.input.config.options = {
        ...f.input.config.options,
        mode: "mirror",
        mapping: { email: "id" },
        streamOptions: {
          audience: { kind: "managed", displayName: "Test" },
          customerMatchTermsAccepted: true,
          exclusiveManagementConfirmed: true,
          mirrorStrategy: "snapshot-diff",
        },
      };
      f.setRows([]);
      let tokenFails = scenario === "oauth-failure",
        creates = 0,
        remote: any;
      f.input.adapters = createAdapterRegistry(async () => {
        if (tokenFails) throw new Error("private-token");
        return "token";
      });
      const saved = async () =>
        (
          await admin.query("SELECT state FROM newjitsu.source_state WHERE sync_id='sync' AND stream=$1", [
            googleAudienceStateStream,
          ])
        ).rows[0]?.state;
      const response = (body: unknown) => new Response(JSON.stringify(body)) as Awaited<ReturnType<typeof fetch>>;
      const wire = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        expect(f.calls).toContain("lease");
        if (init?.method === "POST") {
          creates++;
          expect((await saved()).phase).toBe("submitting");
          expect((await admin.query("SELECT count(*) FROM newjitsu.reverse_sync_control")).rows[0].count).toBe("0");
          remote = {
            ...JSON.parse(init.body as string),
            id: "123",
            name: "accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/123",
            accessReason: "OWNED",
          };
          if (scenario === "lost-response" || scenario === "empty-discovery") throw new Error("lost response");
          return response(remote);
        }
        if (String(url).includes("?")) return response({ userLists: scenario === "empty-discovery" ? [] : [remote] });
        return response(remote);
      });
      try {
        expect(await execute(f.input)).toBe(scenario === "normal" ? "COMPLETE" : "FAILED");
        expect((await saved()).phase).toBe(
          scenario === "normal" ? "ready" : scenario === "oauth-failure" ? "prepared" : "submitting"
        );
        tokenFails = false;
        f.input.taskId = "next";
        expect(await execute(f.input)).toBe(scenario === "empty-discovery" ? "FAILED" : "COMPLETE");
        expect(creates).toBe(1);
        if (scenario !== "empty-discovery") {
          expect((await saved()).audienceId).toBe("123");
          expect((await control()).revision).toBe(f.input.config.configRevision);
          expect((await control()).target_hash).toBeDefined();
        }
        expect(f.input.config.options.streamOptions.audienceId).toBeUndefined();
      } finally {
        wire.mockRestore();
      }
    }
  );
});

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
  for (const table of ["control", "target_owner"])
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON newjitsu.reverse_sync_${table} TO runner_runtime`);
  await admin.query(
    "GRANT SELECT,INSERT,UPDATE ON newjitsu.source_state,newjitsu.source_task TO runner_runtime; GRANT INSERT ON newjitsu.task_log TO runner_runtime"
  );
  db = new Database({ ...config, user: "runner_runtime", password: "runtime" }, storage);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await admin?.end();
  await container?.stop();
});
beforeEach(async () => {
  await admin.query(
    "TRUNCATE newjitsu.reverse_sync_control,newjitsu.reverse_sync_target_owner,newjitsu.source_state,newjitsu.source_task,newjitsu.task_log"
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
async function taskLogs(id: string) {
  return (await admin.query("SELECT message FROM newjitsu.task_log WHERE task_id=$1 ORDER BY timestamp", [id])).rows
    .map(row => row.message)
    .join("\n");
}
async function control() {
  return (await admin.query("SELECT * FROM newjitsu.reverse_sync_control ORDER BY run_order DESC LIMIT 1")).rows[0];
}

function asynchronousFixture() {
  const f = fixture();
  const receipts = new Map<string, BatchResult>();
  f.adapter.stream.batchDelivery = "asynchronous";
  const create = f.adapter.stream.createWriter;
  f.adapter.stream.createWriter = async ctx => ({
    ...(await create(ctx)),
    upsert: async batch => {
      f.calls.push("upsert");
      f.writes.push(batch);
      const result: BatchResult = {
        outcomes: batch.records.map(row => ({ operationId: row.operationId, status: "staged" })),
        remoteJobIds: [batch.batchId],
      };
      receipts.set(batch.batchId, result);
      return result;
    },
  });
  const recovery = f.adapter.recovery!;
  f.adapter.recovery = state => ({
    ...recovery(state),
    reconcileBatch: async batch => {
      f.calls.push("reconcile");
      return receipts.get(batch.batchId)!;
    },
  });
  return { ...f, receipts };
}

describe("executable runner", () => {
  it("records actionable duplicate-identity failures in task details and logs without member values", async () => {
    const f = asynchronousFixture();
    // Distinct model primary keys can normalize to the same destination identity.
    f.adapter.project = () => [
      {
        identity: "private@example.com",
        upsert: { email: "private@example.com" },
        remove: { email: "private@example.com" },
      },
    ];
    expect(await execute(f.input)).toBe("FAILED");
    const failed = await task();
    expect(failed.error).toContain("Multiple source rows identify the same audience member");
    expect(failed.error).toContain("Update the model");
    expect(failed.error).toContain("Run ID: task");
    expect(failed.description).toBe(failed.error);
    expect(failed.error).not.toContain("private@example.com");
    expect((await admin.query("SELECT message FROM newjitsu.task_log WHERE level='ERROR'")).rows).toEqual([
      { message: failed.error },
    ]);
    expect(f.writes).toHaveLength(0);
  });
  it("explains audience ownership conflicts before opening the warehouse", async () => {
    const mirror = fixture();
    mirror.input.config.options.mode = "mirror";
    expect(await execute(mirror.input)).toBe("COMPLETE");
    const f = fixture();
    f.input.config.id = "another-sync";
    f.input.taskId = "another-task";
    expect(await execute(f.input)).toBe("FAILED");
    expect((await task("another-task")).error).toContain("This audience is reserved by another sync");
    expect(f.calls).not.toContain("source");
  });
  it("gives a support reference instead of exposing unexpected provider errors", async () => {
    const f = fixture();
    f.setFailInit();
    expect(await execute(f.input)).toBe("FAILED");
    const failed = await task();
    expect(failed.error).toContain("Contact support or your Jitsu administrator");
    expect(failed.error).toContain("Run ID: task");
    expect(failed.error).not.toMatch(/private-token|inspect.*state/);
  });
  const makeDue = () =>
    admin.query(
      `UPDATE newjitsu.source_task SET metrics=jsonb_set(metrics,'{reverseRecovery,nextCheckAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE status='PENDING'`
    );
  async function refresh(f: { input: ExecuteOptions }, worker: string, parent = "task") {
    await makeDue();
    f.input = { ...f.input, taskId: worker, recoveryOf: parent, trigger: "recovery" };
  }
  it("refreshes paused delivery without extraction and rejects new manual or scheduled runs", async () => {
    const f = asynchronousFixture();
    expect(await execute(f.input)).toBe("PENDING");
    f.input.config.options.disabled = true;
    for (const trigger of ["manual", "scheduled"] as const) {
      f.calls.length = 0;
      expect(await execute({ ...f.input, taskId: trigger, trigger })).toBe("FAILED");
      expect(f.calls).not.toContain("reader");
      expect(f.calls).not.toContain("upsert");
    }
    for (const batch of f.writes) f.receipts.set(batch.batchId, accepted(batch));
    await refresh(f, "paused-check");
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("COMPLETE");
    expect(f.calls).toContain("reconcile");
    expect(f.calls).not.toContain("reader");
  });
  it("refuses an automatic refresh queued before the sync was paused", async () => {
    const f = asynchronousFixture();
    expect(await execute(f.input)).toBe("PENDING");
    await refresh(f, "stale-auto-check");
    f.input.admit = async () => ({ ...f.input.config, options: { ...f.input.config.options, disabled: true } });
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("PENDING");
    expect(f.calls).not.toContain("reader");
    expect(f.calls).not.toContain("reconcile");
    expect(await taskLogs("task")).toContain("Status refresh failed without updating delivery outcomes");
  });
  it("retries rejected conversion keys after explicit cleanup without replaying accepted keys", async () => {
    const f = asynchronousFixture();
    f.input.config.model.cursor = undefined;
    f.adapter.insertOnly = true;
    f.adapter.project = (_action, row: any) => [
      { identity: { eventKey: recordKey([row.id]) }, upsert: row, remove: {} },
    ];
    expect(await execute(f.input)).toBe("PENDING");
    const batch = f.writes[0];
    f.input.taskId = "overlap";
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.writes).toHaveLength(1);
    f.receipts.set(batch.batchId, {
      outcomes: batch.records.map((row, i) =>
        i === 0
          ? { operationId: row.operationId, status: "accepted" }
          : { operationId: row.operationId, status: "rejected", code: "invalid", safeReason: "Invalid" }
      ),
    });
    await refresh(f, "rejected-check");
    expect(await execute(f.input)).toBe("FAILED");
    expect((await control()).phase).toBe("batches_pending");
    // Explicit retry cleans up the failed saved run, but does not re-upload it.
    await admin.query("UPDATE newjitsu.source_task SET status='PENDING' WHERE task_id='task'");
    await refresh(f, "cleanup-check");
    expect(await execute(f.input)).toBe("FAILED");
    expect((await control()).phase).toBe("aborted");
    f.input = { ...f.input, taskId: "retry", trigger: "manual", recoveryOf: undefined };
    expect(await execute(f.input)).toBe("PENDING");
    expect(f.writes).toHaveLength(2);
    expect(f.writes[1].records.map(row => row.row.id)).toEqual(["b"]);
  });
  it.each([false, true])(
    "blocks insert-only overlap until acceptance without advancing the cursor (saved cursor: %s)",
    async seeded => {
      const f = asynchronousFixture();
      f.input.config.model.cursor = { column: "id", type: "string" };
      f.adapter.insertOnly = true;
      f.adapter.project = (_action, row: any) => [
        {
          identity: { eventKey: recordKey([row.id]) },
          upsert: row,
          remove: {},
        },
      ];
      const createWriter = f.adapter.stream.createWriter;
      f.adapter.stream.createWriter = async ctx => {
        const writer = await createWriter(ctx);
        return {
          ...writer,
          init: async () => {
            await writer.init();
            ctx.store.set("latestRun", ctx.logicalRunId);
          },
        };
      };
      const reader = f.input.reader;
      const afters: unknown[] = [];
      f.input.reader = config => {
        const original = reader(config);
        return {
          ...original,
          stream: async function* (model, after, signal) {
            afters.push(after);
            for await (const row of original.stream(model, after, signal))
              if (!after || row.checkpoint!.value > after.value) yield row;
          },
        };
      };
      const saved = async () => {
        const envelope = (await admin.query("SELECT state FROM newjitsu.source_state WHERE stream='_REVERSE_ETL_'"))
          .rows[0]?.state;
        return envelope && { ...envelope, decoded: JSON.parse(envelope.value).value };
      };
      if (seeded) {
        f.setRows([{ id: "0" }]);
        f.input.taskId = "seed";
        expect(await execute(f.input)).toBe("PENDING");
        for (const batch of f.writes) f.receipts.set(batch.batchId, accepted(batch));
        await refresh(f, "seed-check", "seed");
        expect(await execute(f.input)).toBe("COMPLETE");
        // Older version-2 state has only runOrder; upgrades must preserve its fence.
        await admin.query(
          "UPDATE newjitsu.source_state SET state=state-'checkpointRunOrder' WHERE stream='_REVERSE_ETL_'"
        );
      }
      const before = await saved();
      f.setRows([{ id: "a" }, { id: "b" }]);
      f.input = { ...f.input, taskId: "task", trigger: "manual", recoveryOf: undefined };
      const firstWrite = f.writes.length;
      expect(await execute(f.input)).toBe("PENDING");
      const runOrder = (await control()).run_order;
      const count = f.writes.length;
      for (const taskId of ["noop-1", "noop-2"]) {
        f.input.taskId = taskId;
        expect(await execute(f.input)).toBe("FAILED");
        expect(f.writes).toHaveLength(count);
        expect(await saved()).toEqual(before);
        expect((await task(taskId)).error).toContain("previous conversion run is still unresolved");
        expect((await task()).status).toBe("PENDING");
      }
      expect((await control()).run_order).toBe(runOrder);
      for (const batch of f.writes.slice(firstWrite)) f.receipts.set(batch.batchId, accepted(batch));
      await refresh(f, "accepted-check");
      expect(await execute(f.input)).toBe("COMPLETE");
      const acceptedState = await saved();
      expect(acceptedState.checkpointRunOrder).toBe(runOrder);
      expect(acceptedState.decoded.store.latestRun).toBe((await control()).run_id);
      expect(acceptedState.decoded.point.cursor).toEqual({ value: "b", primaryKeyValues: ["b"] });
      f.input = { ...f.input, taskId: "after-acceptance", trigger: "manual", recoveryOf: undefined };
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(afters.at(-1)).toEqual({ value: "b", primaryKeyValues: ["b"] });
      expect(f.writes).toHaveLength(count);
    }
  );
  it.each(["upsert", "mirror"] as const)(
    "allows a new %s upload while an older run is pending and isolates late refresh",
    async mode => {
      const f = asynchronousFixture();
      f.input.config.options.mode = mode;
      if (mode === "mirror") f.adapter.mirror!.batchDelivery = "asynchronous";
      expect(await execute(f.input)).toBe("PENDING");
      const firstRun = (await control()).run_id;
      const firstBatches = [...f.writes];
      f.input.taskId = "second";
      f.setRows([{ id: "b" }, { id: "c" }]);
      expect(await execute(f.input)).toBe("PENDING");
      const secondRun = (await control()).run_id;
      expect(secondRun).not.toBe(firstRun);
      expect((await admin.query("SELECT count(*) FROM newjitsu.reverse_sync_control")).rows[0].count).toBe("2");
      expect((await task()).status).toBe("PENDING");
      expect((await task("second")).status).toBe("PENDING");
      const secondBatches = f.writes.slice(firstBatches.length);
      expect(secondBatches.flatMap(batch => batch.records)).toHaveLength(2);
      for (const batch of secondBatches) f.receipts.set(batch.batchId, accepted(batch));
      await refresh(f, "second-check", "second");
      expect(await execute(f.input)).toBe("COMPLETE");
      const checkpoint = (await admin.query("SELECT state FROM newjitsu.source_state")).rows[0].state;
      expect(checkpoint.runOrder).toBe("1");
      expect((await task()).status).toBe("PENDING");
      for (const batch of firstBatches) f.receipts.set(batch.batchId, accepted(batch));
      await refresh(f, "first-check");
      f.calls.length = 0;
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(f.calls).not.toContain("reader");
      expect((await admin.query("SELECT state FROM newjitsu.source_state")).rows[0].state).toEqual(checkpoint);
      expect((await task()).status).toBe("COMPLETE");
      expect((await task("second")).status).toBe("COMPLETE");
      expect((await admin.query("SELECT count(*) FROM newjitsu.source_task")).rows[0].count).toBe("2");
      expect((await durable()).members.map(m => m.effect.identity).sort()).toEqual(
        mode === "mirror" ? ["b", "c"] : ["a", "b", "c"]
      );
    }
  );
  it("persists WAITING without errors, and a separate recovery trigger polls without opening SQL", async () => {
    const f = asynchronousFixture();
    const before = Date.now();
    expect(await execute(f.input)).toBe("PENDING");
    const waiting = await task();
    expect(waiting.error).toBeNull();
    expect(waiting.metrics.reverseDelivery).toMatchObject({
      upsert: { total: 1, pending: 1 },
      records: { accepted: 0, pending: 2 },
    });
    expect(waiting.started_by.workspaceId).toBe("workspace");
    expect(waiting.metrics.reverseRecovery).toMatchObject({
      runId: (await control()).run_id,
      revision: f.input.config.configRevision,
      attempt: 0,
    });
    expect(Date.parse(waiting.metrics.reverseRecovery.nextCheckAt)).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect((await admin.query("SELECT 1 FROM newjitsu.task_log WHERE level='ERROR'")).rowCount).toBe(0);
    await makeDue();
    f.input = { ...f.input, taskId: "automatic-check", trigger: "recovery", recoveryOf: "task" };
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("PENDING");
    expect(f.calls).toEqual(["lease", "renew", "reconcile", "release"]);
    expect((await task()).status).toBe("PENDING");
    const polled = await task();
    expect(polled.started_by).toEqual(waiting.started_by);
    expect(polled.started_at).toEqual(waiting.started_at);
    expect(polled.metrics.reverseRecovery.attempt).toBe(1);
    expect(polled.metrics.reverseDelivery).toMatchObject({ upsert: { total: 1, pending: 1 } });
    expect(polled.metrics.reverseRecovery.deadline).toBe(waiting.metrics.reverseRecovery.deadline);
    for (const batch of f.writes) f.receipts.set(batch.batchId, accepted(batch));
    await makeDue();
    f.input.taskId = "automatic-complete";
    f.input.recoveryOf = "task";
    expect(await execute(f.input)).toBe("COMPLETE");
    expect((await task()).status).toBe("COMPLETE");
    expect((await task()).metrics.reverseDelivery).toMatchObject({
      upsert: { total: 1, accepted: 1, pending: 0 },
      records: { accepted: 2, pending: 0 },
    });
    expect((await admin.query("SELECT count(*) FROM newjitsu.source_task")).rows[0].count).toBe("1");
    expect((await control()).phase).toBe("complete");
    expect(f.calls).not.toContain("reader");
    const waitingLogs = (await admin.query("SELECT message FROM newjitsu.task_log WHERE task_id='task'")).rows
      .map(r => r.message)
      .join("\n");
    expect(waitingLogs).toContain("2 confirmed submitted in 1 batches; 0 accepted, 2 pending");
    expect(waitingLogs).toContain("2 rows read in this attempt, 2 upsert rows, 0 explicit removal rows");
    expect(waitingLogs.match(/Delivery totals/g)).toHaveLength(3);
    expect(waitingLogs).toContain("Preparing 2 additions/upserts.");
    expect(waitingLogs).toContain("Submitted 2 additions/upserts; 0 accepted, 2 pending processing");
    expect(waitingLogs).not.toContain("may have reached the destination");
    const recoveryLogs = waitingLogs;
    expect(recoveryLogs).toContain("warehouse SQL is not re-read");
    expect(recoveryLogs).toContain("2 confirmed submitted in 1 batches; 2 accepted, 0 pending");
    expect(recoveryLogs.match(/Delivery totals/g)).toHaveLength(3);
    expect(recoveryLogs).toContain("Status updated for 2 additions/upserts: 2 accepted");
    expect(recoveryLogs.match(/Submitted 2 additions\/upserts/g)).toHaveLength(1);
    const unchangedLogs = await taskLogs("automatic-check");
    expect(unchangedLogs).toBe("");
  });
  it.each(["early", "cancelled", "revision", "run", "complete", "foreign", "duplicate"])(
    "does not start an obsolete or unauthorized recovery (%s)",
    async reason => {
      const f = asynchronousFixture();
      await execute(f.input);
      if (reason !== "early") await makeDue();
      if (reason === "cancelled") await admin.query("UPDATE newjitsu.source_task SET status='CANCELLED'");
      if (reason === "revision") f.input.config.configRevision = "b".repeat(64);
      if (reason === "run") await admin.query("UPDATE newjitsu.reverse_sync_control SET run_id='new-run'");
      if (reason === "complete") await admin.query("UPDATE newjitsu.reverse_sync_control SET phase='complete'");
      if (reason === "foreign") f.input.config.workspaceId = "foreign";
      f.input.trigger = "recovery";
      f.input.recoveryOf = "task";
      f.input.taskId = "automatic";
      if (reason === "duplicate") {
        expect(await execute(f.input)).toBe("PENDING");
        f.input.taskId = "duplicate";
      }
      f.calls.length = 0;
      expect(await execute(f.input)).toBe("FAILED");
      expect(f.calls).toEqual(["lease", "release"]);
      expect(await task(f.input.taskId)).toBeUndefined();
      if (reason === "cancelled") expect((await task()).status).toBe("CANCELLED");
      else if (reason !== "duplicate") expect((await task()).status).toBe("PENDING");
    }
  );
  it("keeps real provider rejection FAILED without scheduling another check", async () => {
    const f = asynchronousFixture();
    await execute(f.input);
    await makeDue();
    const batch = f.writes[0];
    f.receipts.set(batch.batchId, {
      outcomes: batch.records.map(row => ({
        operationId: row.operationId,
        status: "rejected",
        code: "invalid",
        safeReason: "Invalid",
      })),
    });
    f.input.trigger = "recovery";
    f.input.recoveryOf = "task";
    f.input.taskId = "rejected-check";
    expect(await execute(f.input)).toBe("FAILED");
    const rejectedMetrics = (await task()).metrics;
    expect(rejectedMetrics.reverseRecovery.runId).toBe((await control()).run_id);
    expect(rejectedMetrics.reverseDelivery).toMatchObject({
      upsert: { total: 1, rejected: 1 },
      records: { rejected: 2 },
    });
    expect((await admin.query("SELECT 1 FROM newjitsu.source_task WHERE status='PENDING'")).rowCount).toBe(0);
    expect((await control()).phase).toBe("batches_pending");
    expect(await taskLogs("task")).toContain(
      "2 confirmed submitted in 1 batches; 0 accepted, 0 pending processing, 2 rejected"
    );
  });
  it("retries a transient refresh failure on the original task without reopening SQL", async () => {
    const f = asynchronousFixture();
    expect(await execute(f.input)).toBe("PENDING");
    const bind = f.adapter.recovery!;
    let fail = true;
    f.adapter.recovery = state => ({
      ...bind(state),
      reconcileBatch: async batch => {
        if (fail) throw new Error("private provider response");
        return accepted(batch);
      },
    });
    await refresh(f, "failed-poll");
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("PENDING");
    expect((await task()).metrics.reverseRecovery.attempt).toBe(1);
    expect(await taskLogs("task")).not.toContain("private provider response");
    fail = false;
    await refresh(f, "next-poll");
    expect(await execute(f.input)).toBe("COMPLETE");
    expect(f.calls).not.toContain("reader");
    expect((await admin.query("SELECT count(*) FROM newjitsu.source_task")).rows[0].count).toBe("1");
  });
  it.each(["manual", "scheduled"] as const)(
    "does not create another task when %s admission encounters a pending non-detached run",
    async trigger => {
      const f = asynchronousFixture();
      expect(await execute(f.input)).toBe("PENDING");
      // Represents an interrupted extraction or migrated WAITING run.
      await admin.query("UPDATE newjitsu.reverse_sync_control SET detached=false");
      const before = await task();
      f.input = { ...f.input, trigger, taskId: "new-attempt" };
      f.calls.length = 0;
      expect(await execute(f.input)).toBe("FAILED");
      expect((await admin.query("SELECT task_id,status FROM newjitsu.source_task")).rows).toEqual([
        { task_id: "task", status: "PENDING" },
      ]);
      expect((await task()).metrics).toEqual(before.metrics);
      expect(f.calls).not.toContain("reader");
      for (const batch of f.writes) f.receipts.set(batch.batchId, accepted(batch));
      await refresh(f, "continue-original");
      expect(await execute(f.input)).toBe("COMPLETE");
      expect((await task()).status).toBe("COMPLETE");
      expect((await admin.query("SELECT count(*) FROM newjitsu.source_task")).rows[0].count).toBe("1");
    }
  );
  it.each(["FAILED", "CANCELLED"])("retains a %s detached run across failed explicit refresh", async previousStatus => {
    const f = asynchronousFixture();
    expect(await execute(f.input)).toBe("PENDING");
    const initial = await task();
    expect((await control()).detached).toBe(true);
    const bind = f.adapter.recovery!;
    f.adapter.recovery = state => ({
      ...bind(state),
      reconcileBatch: async () => {
        throw new ReverseEtlManualReconciliationError();
      },
    });
    await refresh(f, "failed-check");
    expect(await execute(f.input)).toBe("FAILED");
    expect((await task()).metrics.reverseRecovery.runId).toBe(initial.metrics.reverseRecovery.runId);
    const error = (await task()).error;
    // The controller's explicit-refresh transition: same task, new worker.
    await admin.query(
      `
      UPDATE newjitsu.source_task SET status='PENDING',metrics=jsonb_set(
        jsonb_set(metrics,'{reverseRecovery,nextCheckAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)),
        '{reverseRecovery,previousStatus}',to_jsonb($1::text)) WHERE task_id='task'`,
      [previousStatus]
    );
    f.input.taskId = "manual-failed-check";
    f.adapter.recovery = state => ({
      ...bind(state),
      reconcileBatch: async () => {
        throw new Error("temporary lookup failure");
      },
    });
    f.calls.length = 0;
    expect(await execute(f.input)).toBe(previousStatus);
    expect((await task()).status).toBe(previousStatus);
    expect((await task()).metrics.reverseWorker.active).toBe(false);
    expect((await task()).error).toBe(error);
    expect((await task()).metrics.reverseRecovery.runId).toBe(initial.metrics.reverseRecovery.runId);
    await admin.query(`
      UPDATE newjitsu.source_task SET status='PENDING',metrics=jsonb_set(
        metrics,'{reverseRecovery,nextCheckAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE task_id='task'`);
    f.input.taskId = "manual-successful-check";
    f.adapter.recovery = bind;
    for (const batch of f.writes) f.receipts.set(batch.batchId, accepted(batch));
    expect(await execute(f.input)).toBe("COMPLETE");
    expect((await task()).error).toBeNull();
    expect(f.calls).not.toContain("reader");
    expect(f.calls).not.toContain("upsert");
    expect((await admin.query("SELECT count(*) FROM newjitsu.source_task")).rows[0].count).toBe("1");
  });
  it("does not let a queued refresh bypass suspension", async () => {
    const f = asynchronousFixture();
    expect(await execute(f.input)).toBe("PENDING");
    await refresh(f, "late-queued-check");
    await admin.query(
      "UPDATE newjitsu.source_task SET metrics=jsonb_set(metrics,'{reverseRecovery,suspended}','true')"
    );
    const before = await task();
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("FAILED");
    expect(await task()).toEqual(before);
    expect(f.calls).not.toContain("reconcile");
    expect(f.calls).not.toContain("reader");
  });
  it.each([
    "Google replacement cleanup failed or is unverified; manual reconciliation required, no automatic replay",
    "Malformed Google replacement status; manual reconciliation required",
    "Google replacement status target mismatch",
    "Google replacement cleanup receipt unavailable; manual reconciliation required, no automatic replay",
  ])("stops polling a terminal native-replacement result: %s", async reason => {
    const f = fixture();
    f.input.config.options.mode = "mirror";
    f.adapter.stream.capabilities.mirror = "native-replace";
    f.adapter.verifyMirrorBaseline = async () => "replace";
    f.setPending();
    expect(await execute(f.input)).toBe("PENDING");
    const bind = f.adapter.recovery!;
    f.adapter.recovery = state => ({
      ...bind(state),
      reconcileFinish: async () => {
        throw new Error(reason);
      },
    });
    const before = await task();
    await refresh(f, "replacement-failed");
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("FAILED");
    const failed = await task();
    expect(failed.error).toContain("Google audience replacement could not be confirmed");
    expect(failed.metrics.reverseRecovery.runId).toBe(before.metrics.reverseRecovery.runId);
    expect(failed.metrics.reverseRecovery.attempt).toBe(before.metrics.reverseRecovery.attempt);
    expect(f.calls).not.toContain("reader");
    expect(f.calls).not.toContain("finish");
  });
  it("stops automatic polling at its original deadline without losing receipts", async () => {
    const f = asynchronousFixture();
    await execute(f.input);
    await makeDue();
    await admin.query(
      `UPDATE newjitsu.source_task SET metrics=jsonb_set(metrics,'{reverseRecovery,deadline}',to_jsonb('2000-01-02T00:00:00.000Z'::text))`
    );
    f.input.trigger = "recovery";
    f.input.recoveryOf = "task";
    f.input.taskId = "last-check";
    expect(await execute(f.input)).toBe("FAILED");
    expect((await task()).error).toContain("after 24 hours");
    expect((await control()).phase).toBe("batches_pending");
    expect((await durable()).batches.length).toBe(1);
    expect((await admin.query("SELECT 1 FROM newjitsu.source_task WHERE status='PENDING'")).rowCount).toBe(0);
    // A new extraction has its own deadline; it does not reopen this expired run.
    f.input.trigger = "manual";
    f.input.taskId = "manual-after-timeout";
    delete f.input.recoveryOf;
    expect(await execute(f.input)).toBe("PENDING");
    expect((await task()).status).toBe("FAILED");
  });
  it("still cleans up incomplete legacy finish-staged sessions through verified abort", async () => {
    const f = asynchronousFixture();
    f.adapter.stream.batchDelivery = undefined;
    const create = f.adapter.stream.createWriter;
    f.adapter.stream.createWriter = async ctx => {
      const writer = await create(ctx);
      return {
        ...writer,
        upsert: async batch => {
          await writer.upsert(batch);
          throw new Error("lost staged response");
        },
      };
    };
    expect(await execute(f.input)).toBe("FAILED");
    expect((await control()).phase).toBe("running");
    f.input.taskId = "legacy-cleanup";
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).toEqual(["lease", "renew", "reconcile", "reconcileAbort", "release"]);
    expect((await control()).phase).toBe("aborted");
    expect([...new Set((await durable()).operations.map(row => row.status))].map(status => ({ status }))).toEqual([
      { status: "cancelled" },
    ]);
  });
  it("blocks direct batch acknowledgement, cleanup and finish while sealed jobs remain pending", async () => {
    const f = asynchronousFixture();
    await execute(f.input);
    const run = await openPersistence(
      db,
      {
        workspaceId: "workspace",
        syncId: "sync",
        logicalRunId: (await control()).run_id,
        taskId: "probe",
        configRevision: f.input.config.configRevision,
        targetIdentity: f.adapter.targetIdentity,
        mode: "upsert",
        extraction: "full",
      },
      f.adapter.project
    );
    await expect(run.delivery.prepareFinish(2, {})).rejects.toThrow();
    await expect(run.delivery.prepareAbort()).rejects.toThrow();
    await expect(run.delivery.acknowledge(f.writes[0].batchId, accepted(f.writes[0]), {})).rejects.toThrow();
    expect((await control()).phase).toBe("batches_pending");
  });
  it.each([false, true])("settles independent batches without re-extraction (cursor=%s)", async cursor => {
    const f = asynchronousFixture();
    if (cursor) f.input.config.model.cursor = { column: "id", type: "string" };
    f.setRows([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(await execute(f.input)).toBe("PENDING");
    expect((await control()).phase).toBe("batches_pending");
    expect(f.calls).not.toContain("finish");
    expect((await admin.query("SELECT count(*) FROM newjitsu.source_state")).rows[0].count).toBe("0");

    await refresh(f, "poll");
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("PENDING");
    expect(f.calls).toEqual(["lease", "renew", "reconcile", "reconcile", "release"]);
    expect((await control()).phase).toBe("batches_pending");

    for (const batch of f.writes) f.receipts.set(batch.batchId, accepted(batch));
    await refresh(f, "complete");
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("COMPLETE");
    expect(f.calls).toEqual(["lease", "renew", "reconcile", "reconcile", "attach", "finish", "release"]);
    expect((await control()).phase).toBe("complete");
    const state = (await admin.query("SELECT state FROM newjitsu.source_state")).rows[0].state;
    expect(JSON.parse(state.value).value.point).toEqual({
      sourceSequence: 3,
      ...(cursor ? { cursor: { value: "c", primaryKeyValues: ["c"] } } : {}),
    });
    expect(f.writes).toHaveLength(2);
  });
  it("retains partial accepted effects after independent jobs reject rows, without finalizing", async () => {
    const f = asynchronousFixture();
    await execute(f.input);
    const batch = f.writes[0];
    f.receipts.set(batch.batchId, {
      outcomes: [
        { operationId: batch.records[0].operationId, status: "accepted" },
        { operationId: batch.records[1].operationId, status: "rejected", code: "invalid", safeReason: "Invalid" },
      ],
    });
    await refresh(f, "rejected");
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).toEqual(["lease", "renew", "reconcile", "release"]);
    expect((await control()).phase).toBe("batches_pending");
    expect(String((await durable()).members.length)).toBe("1");
    expect((await task()).status).toBe("FAILED");
    expect(f.calls).not.toContain("finish");
  });
  it("rejects overlapping async identities before the conflicting provider request", async () => {
    const f = asynchronousFixture();
    f.adapter.stream.batchSize = 1;
    f.adapter.project = () => [{ identity: "shared", upsert: { id: "shared" }, remove: { id: "shared" } }];
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.writes).toHaveLength(1);
    expect((await control()).phase).toBe("running");
    expect(f.calls).not.toContain("abort");
    f.input.taskId = "still-pending";
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("PENDING");
    expect(f.calls).toEqual(["lease", "renew", "reconcile", "release"]);
    expect((await control()).phase).toBe("running");
    f.input.taskId = "do-not-duplicate-pending";
    expect(await execute(f.input)).toBe("FAILED");
    expect(await task("do-not-duplicate-pending")).toBeUndefined();
  });
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
  it("shares an in-flight heartbeat renewal when slow provisioning finishes", async () => {
    const f = fixture();
    let ready!: () => void;
    const heartbeatStarted = new Promise<void>(resolve => {
      ready = resolve;
    });
    let inFlight = 0;
    let maximum = 0;
    f.input.heartbeatMs = 5;
    f.input.lease.renew = async () => {
      maximum = Math.max(maximum, ++inFlight);
      ready();
      await new Promise(resolve => setTimeout(resolve, 40));
      inFlight--;
    };
    f.input.adapters = new Map([
      [
        String(f.input.config.destination.destinationType),
        async () => {
          await heartbeatStarted;
          return f.adapter;
        },
      ],
    ]);
    expect(await execute(f.input)).toBe("COMPLETE");
    expect(maximum).toBe(1);
  });
  it("runs upsert with restricted DB grants, task logs and Kubernetes admission", async () => {
    const f = fixture();
    expect(await execute(f.input)).toBe("COMPLETE");
    expect((await task()).status).toBe("COMPLETE");
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
    expect(await execute(f.input)).toBe("COMPLETE");
    const logs = (await admin.query("SELECT message FROM newjitsu.task_log ORDER BY timestamp")).rows.map(
      r => r.message
    );
    expect(logs).toContain("Extracted 2 source rows into snapshot; no audience changes submitted yet");
    expect(logs).toContain(
      "Snapshot complete: 2 source rows, 2 projected audience members, 2 unique audience members, 0 duplicates collapsed. Comparing audience membership and submitting changes."
    );
    f.input.taskId = "empty";
    f.setRows([]);
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("COMPLETE");
    expect(f.calls).toContain("remove");
    expect(String((await durable()).members.length)).toBe("0");
    expect((await admin.query("SELECT message FROM newjitsu.task_log WHERE task_id='empty'")).rows).toContainEqual({
      message:
        "Snapshot complete: 0 source rows, 0 projected audience members, 0 unique audience members, 0 duplicates collapsed. Comparing audience membership and submitting changes.",
    });
  });
  it("logs deduplication of projected members rather than subtracting source rows", async () => {
    const f = fixture();
    f.input.config.options.mode = "mirror";
    f.setRows([{ id: "a" }, { id: "b" }, { id: "excluded" }]);
    f.adapter.project = (_action, row: any) =>
      row.id === "excluded"
        ? []
        : ["private-member-1", "private-member-2"].map(id => ({ identity: id, upsert: { id }, remove: { id } }));
    expect(await execute(f.input)).toBe("COMPLETE");
    const logs = (await admin.query("SELECT message FROM newjitsu.task_log")).rows;
    expect(logs).toContainEqual({
      message:
        "Snapshot complete: 3 source rows, 4 projected audience members, 2 unique audience members, 2 duplicates collapsed. Comparing audience membership and submitting changes.",
    });
    expect(JSON.stringify(logs)).not.toContain("private-member");
    expect(JSON.stringify(logs)).toContain("2 duplicates collapsed, 1 source rows excluded by projection");
    expect(f.writes.flatMap(batch => batch.records)).toHaveLength(2);
  });
  it("preserves the original mirror comparison while a later attempt accepts additions and removes old members", async () => {
    const baseline = fixture();
    baseline.input.config.options.mode = "mirror";
    expect(await execute(baseline.input)).toBe("COMPLETE");

    const f = asynchronousFixture();
    f.input.config.options.mode = "mirror";
    f.adapter.mirror!.batchDelivery = "asynchronous";
    f.input.taskId = "diff";
    f.setRows([{ id: "b" }, { id: "c" }, { id: "duplicate-c" }]);
    f.adapter.project = (_action, row: any) => {
      const id = row.id === "duplicate-c" ? "c" : row.id;
      return [{ identity: id, upsert: { id }, remove: { id } }];
    };
    expect(await execute(f.input)).toBe("PENDING");
    const initialLogs = await taskLogs("diff");
    expect(initialLogs).toContain(
      "2 previously acknowledged members; 1 new, 0 changed, 0 unchanged due for expiry refresh, 1 unchanged skipped, 1 to remove"
    );
    expect(initialLogs).toContain("3 source rows, 2 unique members, 3 projected members, 1 duplicates collapsed");
    expect(initialLogs).toContain("1 confirmed submitted in 1 batches; 0 accepted, 1 pending");
    expect(initialLogs).toContain("Removals are blocked until all additions/updates/refreshes are accepted");
    expect(initialLogs.match(/Delivery totals/g)).toHaveLength(1);
    expect(f.calls).not.toContain("remove");

    for (const batch of f.writes) f.receipts.set(batch.batchId, accepted(batch));
    await refresh(f, "diff-status-check", "diff");
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("COMPLETE");
    const resumedLogs = await taskLogs("diff");
    expect(resumedLogs).toContain("warehouse SQL is not re-read");
    expect(resumedLogs).toContain("2 previously acknowledged members; 1 new");
    expect(resumedLogs).toContain("Removals: 1 confirmed submitted in 1 batches; 1 accepted, 0 pending");
    expect(resumedLogs.match(/Delivery totals/g)).toHaveLength(2);
    expect(resumedLogs).toContain("Preparing 1 removals.");
    expect(resumedLogs).toContain("Submitted 1 removals; 1 accepted");
    expect(f.calls).toContain("remove");
    expect(f.calls).not.toContain("reader");
    expect((await durable()).members).toHaveLength(2);
  });
  it("reports the failing mirror stage and counters without exposing warehouse errors", async () => {
    const f = fixture();
    f.input.config.options.mode = "mirror";
    const reader = f.input.reader(f.input.config.warehouse);
    f.input.reader = () => ({
      ...reader,
      stream: async function* () {
        yield { row: { id: "one" }, deleted: false };
        throw new Error("private-user@example.com secret-token");
      },
    });
    expect(await execute(f.input)).toBe("FAILED");
    const failed = await task();
    expect(failed.error).toContain("during extraction (read 1 rows, saved 0)");
    expect(failed.error).toContain("Check warehouse connectivity and query timeouts");
    expect(failed.error).not.toMatch(/private-user|secret-token/);
    expect(f.writes).toHaveLength(0);
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
      { ...storage, limits: { batchRecords: 2 } }
    );
    f.input.db = bounded;
    f.adapter.stream.batchSize = 1000;
    f.setRows([{ id: "a" }, { id: "b" }, { id: "c" }]);
    try {
      expect(await execute(f.input)).toBe("COMPLETE");
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
    expect(await execute(f.input)).toBe("PENDING");
    const logical = (await control()).run_id;
    await refresh(f, "recovery");
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("COMPLETE");
    expect(f.calls).toEqual(["lease", "renew", "reconcileFinish", "release"]);
    expect((await control()).run_id).toBe(logical);
    expect((await task()).status).toBe("COMPLETE");
  });
  it("does not restore pending after committed delivery when task completion bookkeeping fails", async () => {
    const f = fixture();
    f.setPending();
    expect(await execute(f.input)).toBe("PENDING");
    await refresh(f, "completion-check");
    const finish = vi
      .spyOn(Tasks.prototype, "finish")
      .mockRejectedValueOnce(new Error("database temporarily unavailable"));
    try {
      expect(await execute(f.input)).toBe("FAILED");
      expect((await control()).phase).toBe("complete");
      const saved = await task();
      expect(saved.status).toBe("FAILED");
      expect(saved.metrics.reverseWorker.active).toBe(false);
      expect(finish).toHaveBeenCalledTimes(2);
    } finally {
      finish.mockRestore();
    }
  });
  it("executes managed Google mirror, resumes exact wire payloads and refreshes only when due", async () => {
    const f = fixture();
    const managed = {
      id: `retl-google-${"b".repeat(64)}`,
      syncId: "sync",
      customerId: "1234567890",
      audienceId: "123",
      integrationCode: `jitsu-retl-${"b".repeat(64)}`,
      displayName: "Managed",
      membershipDays: 540,
    };
    f.input.config.destination = {
      destinationType: "google-ads",
      authorized: true,
      oauthConnectionId: "destination.destination",
      customerId: "1234567890",
      reverseManagedAudience: managed,
    };
    f.input.config.options.mode = "mirror";
    f.input.config.options.mapping = { email: "id", adUserData: "consent", adPersonalization: "consent" };
    f.input.config.options.streamOptions = {
      audienceId: "123",
      customerMatchTermsAccepted: true,
      managedAudienceId: managed.id,
    };
    const originalReader = f.input.reader;
    f.input.reader = connection => ({
      ...originalReader(connection),
      stream: async function* () {
        f.calls.push("google-source");
        yield { row: { id: "Private.Person+tag@gmail.com", consent: "GRANTED" }, deleted: false };
      },
    });
    const response = (body: unknown) => new Response(JSON.stringify(body)) as Awaited<ReturnType<typeof fetch>>;
    let submits = 0;
    const bodies: unknown[] = [];
    const wire = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/userLists/123"))
        return response({
          name: "accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/123",
          id: "123",
          displayName: managed.displayName,
          integrationCode: managed.integrationCode,
          membershipDuration: "46656000s",
          membershipStatus: "OPEN",
          accessReason: "OWNED",
          ingestedUserListInfo: {
            uploadKeyTypes: ["CONTACT_ID"],
            contactIdInfo: { dataSourceType: "DATA_SOURCE_TYPE_FIRST_PARTY" },
          },
        });
      if (String(url).includes("audienceMembers:ingest")) {
        bodies.push(JSON.parse(init!.body as string));
        return response({ requestId: `job-${++submits}` });
      }
      expect(String(url)).toContain("requestStatus:retrieve?requestId=job-");
      return response({
        requestStatusPerDestination: [
          {
            destination: {
              operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
              productDestinationId: "123",
            },
            requestStatus: "SUCCESS",
            audienceMembersIngestionStatus: { userDataIngestionStatus: { recordCount: "1" } },
          },
        ],
      });
    });
    try {
      f.input.adapters = createAdapterRegistry(async () => "access-token");
      expect(await execute(f.input)).toBe("PENDING");
      expect(submits).toBe(1);
      await refresh(f, "resume");
      f.input.adapters = createAdapterRegistry(async () => "access-token");
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(f.calls.filter(c => c === "google-source")).toHaveLength(1);
      f.input.taskId = "fresh";
      f.input.trigger = "manual";
      delete f.input.recoveryOf;
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(submits).toBe(1);
      expect(await taskLogs("fresh")).toContain("1 unchanged skipped");
      expect(await taskLogs("fresh")).toContain("No audience changes or expiry refreshes needed");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 31 * 86400_000);
      f.input.taskId = "refresh";
      expect(await execute(f.input)).toBe("PENDING");
      expect(submits).toBe(2);
      expect(await taskLogs("refresh")).toContain("1 unchanged due for expiry refresh, 0 unchanged skipped");
      expect(bodies[1]).toEqual(bodies[0]);
      expect(JSON.stringify(bodies)).not.toContain("Private.Person");
      await refresh(f, "refresh-resume", "refresh");
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(await taskLogs("refresh")).toContain("1 unchanged due for expiry refresh, 0 unchanged skipped");
      expect(await taskLogs("refresh")).toContain("1 confirmed submitted in 1 batches; 1 accepted, 0 pending");
    } finally {
      wire.mockRestore();
    }
  });

  it("replaces an existing Google audience across upload and cleanup status checks without replay or re-extraction", async () => {
    const f = fixture();
    f.input.config.destination = {
      destinationType: "google-ads",
      authorized: true,
      oauthConnectionId: "destination.destination",
      customerId: "1234567890",
    };
    f.input.config.options.mode = "mirror";
    f.input.config.options.mapping = { email: "id" };
    f.input.config.options.streamOptions = {
      audienceId: "123",
      customerMatchTermsAccepted: true,
      mirrorStrategy: "full-replace",
      exclusiveManagementConfirmed: true,
    };
    f.setRows([{ id: "one@example.com" }, { id: "two@example.com" }]);
    f.input.adapters = createAdapterRegistry(async () => "access-token");
    const cutoff = "2026-09-20T07:00:00.000Z";
    let uploads = 0,
      cleanups = 0,
      uploadsAccepted = false,
      cleanupAccepted = false;
    const response = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { Date: new Date(cutoff).toUTCString() } }) as Awaited<
        ReturnType<typeof fetch>
      >;
    const wire = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/userLists/123"))
        return response({
          id: "123",
          name: "accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/123",
          displayName: "Existing",
          membershipDuration: "46656000s",
          membershipStatus: "OPEN",
          accessReason: "OWNED",
          ingestedUserListInfo: {
            uploadKeyTypes: ["CONTACT_ID"],
            contactIdInfo: { dataSourceType: "DATA_SOURCE_TYPE_FIRST_PARTY" },
          },
        });
      if (String(url).endsWith("audienceMembers:ingest")) {
        expect(JSON.parse((await control()).store.toString()).value.googleAudienceReplacement.cutoff).toBe(cutoff);
        expect(JSON.parse(init!.body as string).audienceMembers).toHaveLength(2);
        return response({ requestId: `upload-${++uploads}` });
      }
      if (String(url).endsWith("audienceMembers:removeAll")) {
        expect(uploadsAccepted).toBe(true);
        expect((await control()).phase).toBe("finish_prepared");
        expect(JSON.parse(init!.body as string)).toEqual({
          destinations: [
            { operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" }, productDestinationId: "123" },
          ],
          removeAsOfTime: cutoff,
        });
        return response({ requestId: `cleanup-${++cleanups}` });
      }
      expect(String(url)).toContain("requestStatus:retrieve?requestId=");
      expect(init?.method).toBe("GET");
      const cleanup = String(url).includes("requestId=cleanup-");
      return response({
        requestStatusPerDestination: [
          {
            destination: {
              operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
              productDestinationId: "123",
            },
            requestStatus: (cleanup ? cleanupAccepted : uploadsAccepted) ? "SUCCESS" : "PROCESSING",
            ...(cleanup
              ? { removeAllAudienceMembersStatus: {} }
              : { audienceMembersIngestionStatus: { userDataIngestionStatus: { recordCount: "2" } } }),
          },
        ],
      });
    });
    try {
      expect(await execute(f.input)).toBe("PENDING");
      expect(uploads).toBe(1);
      expect(cleanups).toBe(0);
      expect(await taskLogs("task")).toContain("All 2 members will be uploaded");
      expect(await taskLogs("task")).not.toContain("unchanged skipped");
      await makeDue();
      f.input = { ...f.input, taskId: "upload-check", trigger: "recovery", recoveryOf: "task" };
      expect(await execute(f.input)).toBe("PENDING");
      uploadsAccepted = true;
      await makeDue();
      f.input = { ...f.input, taskId: "start-cleanup", recoveryOf: "task" };
      expect(await execute(f.input)).toBe("PENDING");
      expect(cleanups).toBe(1);
      expect(await taskLogs("task")).toContain("Google is processing full-audience cleanup");
      expect(await taskLogs("task")).toContain("Full-audience cleanup: pending");
      expect(await taskLogs("task")).not.toContain("Removals: 0");
      await makeDue();
      f.input = { ...f.input, taskId: "cleanup-check", recoveryOf: "task" };
      expect(await execute(f.input)).toBe("PENDING");
      cleanupAccepted = true;
      await makeDue();
      f.input = { ...f.input, taskId: "complete-cleanup", recoveryOf: "task" };
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(await taskLogs("task")).toContain("Full-audience cleanup: accepted");
      expect((await taskLogs("task")).match(/Delivery totals/g)).toHaveLength(5);
      expect(uploads).toBe(1);
      expect(cleanups).toBe(1);
      expect(f.calls.filter(c => c === "source")).toHaveLength(1);
      expect((await control()).phase).toBe("complete");
    } finally {
      wire.mockRestore();
    }
  });

  it("rejects Google mirroring without an exact sync/account/audience binding", () => {
    const cfg = config();
    cfg.destination = {
      destinationType: "google-ads",
      authorized: true,
      oauthConnectionId: "destination.destination",
      customerId: "1234567890",
    };
    cfg.options.mode = "mirror";
    cfg.options.streamOptions = { audienceId: "123", customerMatchTermsAccepted: true };
    const create = createAdapterRegistry(async () => "token").get("google-ads")!;
    expect(() => create(cfg)).toThrow("cannot be mirrored");
    cfg.options.streamOptions.managedAudienceId = `retl-google-${"a".repeat(64)}`;
    cfg.destination.reverseManagedAudience = {
      id: cfg.options.streamOptions.managedAudienceId,
      syncId: "other",
      customerId: "1234567890",
      audienceId: "123",
      integrationCode: `jitsu-retl-${"a".repeat(64)}`,
      displayName: "Managed",
      membershipDays: 540,
    };
    expect(() => create(cfg)).toThrow("binding mismatch");
  });

  it("recovers a Google request after restart using the durable normalized receipt, without source replay", async () => {
    const f = fixture();
    f.input.config.destination = {
      destinationType: "google-ads",
      authorized: true,
      oauthConnectionId: "destination.destination",
      customerId: "1234567890",
    };
    f.input.config.options.mapping = { email: "id", adUserData: "consent", adPersonalization: "consent" };
    f.input.config.options.streamOptions = { audienceId: "123", customerMatchTermsAccepted: true };
    const originalReader = f.input.reader;
    f.input.reader = connection => ({
      ...originalReader(connection),
      stream: async function* () {
        f.calls.push("google-source");
        yield { row: { id: "Private.Person+tag@gmail.com", consent: "GRANTED" }, deleted: false };
      },
    });
    let polls = 0;
    // Node's Response constructor and the workspace's ambient fetch declaration
    // differ only in json()'s generic signature; runtime responses are native.
    const response = (body: unknown) => new Response(JSON.stringify(body)) as Awaited<ReturnType<typeof fetch>>;
    const wire = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(init?.headers).toEqual({ Authorization: "Bearer access-token", "Content-Type": "application/json" });
      if (String(url).includes("audienceMembers:ingest")) return response({ requestId: "durable-job" });
      expect(String(url)).toContain("requestStatus:retrieve?requestId=durable-job");
      polls++;
      return response({
        requestStatusPerDestination: [
          {
            destination: {
              operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
              productDestinationId: "123",
            },
            requestStatus: polls === 1 ? "PROCESSING" : "SUCCESS",
            ...(polls === 1
              ? {}
              : { audienceMembersIngestionStatus: { userDataIngestionStatus: { recordCount: "1" } } }),
          },
        ],
      });
    });
    try {
      f.input.adapters = createAdapterRegistry(async () => "access-token");
      expect(await execute(f.input)).toBe("PENDING");
      expect((await control()).phase).toBe("batches_pending");
      const logicalRun = (await control()).run_id;
      const saved = (await durable()).batches;
      expect(saved).toHaveLength(1);
      const serialized = JSON.stringify(saved);
      expect(serialized).toContain("durable-job");
      expect(serialized).not.toContain("Private.Person");
      expect(serialized).not.toContain("access-token");
      // New registry/client instances simulate a different worker process.
      f.input.adapters = createAdapterRegistry(async () => "access-token");
      await refresh(f, "google-pending");
      expect(await execute(f.input)).toBe("PENDING");
      f.input.adapters = createAdapterRegistry(async () => "access-token");
      await refresh(f, "google-accepted");
      expect(await execute(f.input)).toBe("COMPLETE");
      expect((await control()).run_id).toBe(logicalRun);
      expect((await control()).checkpoint_sequence).toBe("1");
      expect(f.calls.filter(call => call === "google-source")).toHaveLength(1);
      expect(wire.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
      expect(String((await durable()).members.length)).toBe("1");
    } finally {
      wire.mockRestore();
    }
  });
  it("preserves cursor when recovered finish commits the exact last manifest", async () => {
    const f = fixture();
    f.input.config.model.cursor = { column: "id", type: "string" };
    f.setPending();
    expect(await execute(f.input)).toBe("PENDING");
    await refresh(f, "recovery");
    expect(await execute(f.input)).toBe("COMPLETE");
    expect((await control()).checkpoint_sequence).toBe("2");
  });
  it("recovers an empty cursor run from its plain JSON checkpoint without keys", async () => {
    const f = fixture();
    f.input.config.model.cursor = { column: "id", type: "string" };
    f.setRows([{ id: "a\u0000b" }]);
    expect(await execute(f.input)).toBe("COMPLETE");
    const saved = (await admin.query("SELECT state FROM newjitsu.source_state")).rows[0].state;
    expect(saved.version).toBe(2);
    const point = JSON.parse(saved.value).value.point;
    expect(point.cursor).toEqual({ value: "a\u0000b", primaryKeyValues: ["a\u0000b"] });

    f.setRows([]);
    f.setPending();
    f.input.taskId = "empty";
    expect(await execute(f.input)).toBe("PENDING");
    await refresh(f, "recovery", "empty");
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("COMPLETE");
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
    const failedLogs = await taskLogs("task");
    expect(failedLogs.match(/Delivery totals/g)).toHaveLength(1);
    expect(failedLogs).toContain("Confirmation missing for 2 additions/upserts");
    expect(failedLogs).toContain("2 prepared/unconfirmed");
    expect(failedLogs).toContain("may have reached the destination");
    f.input.taskId = "recovery";
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).toEqual(["lease", "renew", "reconcile", "reconcileAbort", "release"]);
    expect((await control()).phase).toBe("aborted");
    expect(String((await durable()).members.length)).toBe("2");
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
