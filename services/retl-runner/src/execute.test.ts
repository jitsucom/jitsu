import { createHash } from "node:crypto";
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
import * as http from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createWarehouseReader } from "@jitsu/warehouse-query";
import { createGuardedRequest } from "@jitsu/destination-functions/src/functions/lib/guarded-request";
import { defaultDeliveryDeps } from "@jitsu/destination-functions/src/functions/webhook/deliver";
import { createWebhookRuntime } from "@jitsu/destination-functions/src/functions/webhook/runtime";

import { MemoryObjects, persisted } from "./artifacts/test-support";
import { gunzipSync } from "node:zlib";
import { Artifacts } from "./artifacts/store";
const objects = new MemoryObjects();
const storage = { objectStorage: { store: objects, signal: new AbortController().signal } };
const durable = () => persisted(admin, objects);
afterEach(() => vi.useRealTimers());

describe("Meta Reverse ETL runner integration", () => {
  const metaResponse = (body: unknown) =>
    new Response(JSON.stringify(body)) as Awaited<ReturnType<typeof globalThis.fetch>>;
  it("logs a missing website user-agent mapping without leaking row data or submitting events", async () => {
    const f = fixture();
    f.input.config.destination = { destinationType: "facebook-conversions", accessToken: "private-meta-token" };
    f.input.config.model.cursor = undefined;
    f.input.config.options = {
      ...f.input.config.options,
      stream: "conversions",
      mode: "upsert",
      mapping: { email: "id", eventSourceUrl: "url" },
      streamOptions: { pixelId: "789", actionSource: "website", eventName: "Lead" },
    };
    f.input.adapters = createAdapterRegistry(vi.fn());
    const rows = [{ id: "private@example.com", url: "https://example.com/private-path" }];
    f.setRows(rows);
    const wire = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider request"));
    try {
      expect(await execute(f.input)).toBe("FAILED");
      expect(wire).not.toHaveBeenCalled();
      const errors = (await admin.query("SELECT message FROM newjitsu.task_log WHERE level='ERROR'")).rows;
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Client user agent is required when Action source is "website"');
      expect(errors[0].message).toContain("Map a column to Client user agent");
      expect(errors[0].message).toContain("This row was not submitted");
      expect(errors[0].message).not.toContain("private");
      const task = (await admin.query("SELECT error FROM newjitsu.source_task WHERE task_id=$1", [f.input.taskId]))
        .rows[0];
      expect(task.error).toBe(errors[0].message);
    } finally {
      wire.mockRestore();
    }
  });
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
  it.each(["invalid-row", "duplicate-key", "source-failure", "identifier-type"])(
    "validates the whole first snapshot before creating an audience: %s",
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
        mapping: { email: "email" },
        streamOptions: {
          audience: { kind: "managed", displayName: "Test" },
          customerMatchTermsAccepted: true,
          exclusiveManagementConfirmed: true,
        },
      };
      f.input.adapters = createAdapterRegistry(async () => "token");
      if (scenario === "identifier-type") f.input.config.options.streamOptions.identifierType = "CRM_ID";
      const inputRows = [
        { id: "a", email: "good@example.com" },
        {
          id: scenario === "duplicate-key" ? "a" : "b",
          email: scenario === "invalid-row" ? "invalid" : "valid@example.com",
        },
      ];
      f.setRows(inputRows);
      if (scenario === "source-failure") {
        const reader = f.input.reader;
        f.input.reader = config => {
          const original = reader(config);
          return {
            ...original,
            stream: async function* (model, after, signal) {
              yield* original.stream(model, after, signal);
              throw new Error("private SQL error");
            },
          };
        };
      }
      const wire = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected Google call"));
      try {
        expect(await execute(f.input)).toBe("FAILED");
        expect(wire).not.toHaveBeenCalled();
        expect(
          (await admin.query("SELECT count(*) FROM newjitsu.source_state WHERE stream=$1", [googleAudienceStateStream]))
            .rows[0].count
        ).toBe("0");
        expect(await control()).toBeUndefined();
        expect(await taskLogs("task")).not.toContain("private SQL");
      } finally {
        wire.mockRestore();
      }
    }
  );
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
        expect(f.calls.filter(call => call === "reader")).toHaveLength(1);
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

describe("retention bucket routing through the run loop", () => {
  // With a retention bucket the projected effects, which stay in the main store, must hold no row data (as for webhook).
  const payloadFree = (f: ReturnType<typeof fixture>) => {
    f.adapter.project = (_action, row: any) => [
      { identity: createHash("sha256").update(String(row.id)).digest("hex"), upsert: {}, remove: {} },
    ];
  };
  const decoded = (store: MemoryObjects) =>
    [...store.objects.entries()].map(([key, value]) => ({
      key,
      value: JSON.parse(gunzipSync(value).toString()).value as any,
    }));
  // A batch carries rows either inline (no retention bucket) or as a separate artifact; the manifest has null rows.
  const carriesRows = (value: any) =>
    (Array.isArray(value?.rows) && value.rows.length > 0) ||
    !!value?.batch?.records?.some((record: any) => record.row !== null && record.row !== undefined);
  function retentionDb(main: MemoryObjects, retention: MemoryObjects) {
    return new Database(
      {
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: "runner_test",
        user: "runner_runtime",
        password: "runtime",
      },
      { objectStorage: { store: main, signal: new AbortController().signal, retention } }
    );
  }

  it("stores the rows, and only the rows, in the retention bucket", async () => {
    const main = new MemoryObjects(),
      retention = new MemoryObjects(),
      rdb = retentionDb(main, retention);
    try {
      const f = fixture();
      payloadFree(f);
      f.input.db = rdb;
      expect(await execute(f.input)).toBe("COMPLETE");
      const kept = decoded(retention);
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.every(object => object.key.startsWith("r1/") && Array.isArray(object.value.rows))).toBe(true);
      expect(kept.flatMap(object => object.value.rows.map((row: any) => row.id)).sort()).toEqual(["a", "b"]);
      const rest = decoded(main);
      expect(rest.length).toBeGreaterThan(0);
      expect(rest.every(object => object.key.startsWith("v1/") && !carriesRows(object.value))).toBe(true);
      // The batch manifest stays in the main store, with its rows replaced by a reference.
      const manifests = rest.filter(object => object.value?.batch?.records);
      expect(manifests.length).toBeGreaterThan(0);
      expect(
        manifests.every(object => object.value.rows && object.value.batch.records.every((r: any) => r.row === null))
      ).toBe(true);
    } finally {
      await rdb.close();
    }
  });

  it("a destination whose projections hold row data is refused with a readable message when retention is configured", async () => {
    const main = new MemoryObjects(),
      retention = new MemoryObjects(),
      rdb = retentionDb(main, retention);
    try {
      const f = fixture(); // the default projection keeps the row in the effects, which would never expire
      f.input.db = rdb;
      expect(await execute(f.input)).toBe("FAILED");
      expect((await task()).error).toContain("cannot expire");
      expect(retention.objects.size).toBe(0);
      expect(f.calls).not.toContain("upsert");
    } finally {
      await rdb.close();
    }
  });

  it("a run without a retention bucket stores everything in the main bucket, as before", async () => {
    const main = new MemoryObjects(),
      rdb = retentionDb(main, undefined as any);
    try {
      const f = fixture();
      payloadFree(f);
      f.input.db = rdb;
      expect(await execute(f.input)).toBe("COMPLETE");
      const all = decoded(main);
      expect(all.every(object => object.key.startsWith("v1/"))).toBe(true);
      expect(all.some(object => carriesRows(object.value))).toBe(true);
    } finally {
      await rdb.close();
    }
  });

  it("after the retention window the next run still works: only an unresolved batch needs its rows", async () => {
    const main = new MemoryObjects(),
      retention = new MemoryObjects(),
      rdb = retentionDb(main, retention);
    try {
      const f = fixture();
      payloadFree(f);
      f.input.db = rdb;
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(retention.objects.size).toBeGreaterThan(0);
      retention.objects.clear(); // the bucket's lifecycle rule has deleted every expired row object
      f.input = { ...f.input, taskId: "task-after-expiry" };
      expect(await execute(f.input)).toBe("COMPLETE");
      // The new run wrote its own rows; the expired objects were never needed.
      expect(retention.objects.size).toBeGreaterThan(0);
    } finally {
      await rdb.close();
    }
  });

  it("a poison record stops the run; after its rows expire and the endpoint is fixed the next run delivers everything", async () => {
    const main = new MemoryObjects(),
      retention = new MemoryObjects(),
      rdb = retentionDb(main, retention);
    try {
      const f = fixture();
      payloadFree(f);
      f.input.db = rdb;
      // First run: the destination rejects one record, which stops the run (a rejected batch stays in the head).
      const createWriter = f.adapter.stream.createWriter;
      f.adapter.stream.createWriter = async ctx => {
        const writer = await createWriter(ctx);
        return {
          ...writer,
          upsert: async batch => ({
            outcomes: batch.records.map((record, i) =>
              i === 0
                ? {
                    operationId: record.operationId,
                    status: "rejected" as const,
                    code: "invalid",
                    safeReason: "Invalid",
                  }
                : { operationId: record.operationId, status: "accepted" as const }
            ),
          }),
        };
      };
      expect(await execute(f.input)).toBe("FAILED");
      expect(retention.objects.size).toBeGreaterThan(0);
      // The window passes before anyone fixes the endpoint: the bucket's lifecycle rule deletes the rows.
      retention.objects.clear();
      // Endpoint fixed. The next scheduled run must not need the expired rows.
      f.adapter.stream.createWriter = createWriter;
      f.writes.length = 0;
      f.input = { ...f.input, taskId: "task-after-fix" };
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(f.writes.flatMap(batch => batch.records.map(record => (record.row as any).id)).sort()).toEqual(["a", "b"]);
    } finally {
      await rdb.close();
    }
  });

  it("replay refuses rows that do not match the batch manifest instead of sending them", async () => {
    const main = new MemoryObjects(),
      retention = new MemoryObjects(),
      rdb = retentionDb(main, retention);
    // A writer bug: the stored rows artifact is internally valid but is not the batch the manifest describes.
    const original = Artifacts.prototype.put;
    const spy = vi
      .spyOn(Artifacts.prototype, "put")
      .mockImplementation(function (this: Artifacts, value: any, kind?: any) {
        return original.call(
          this,
          kind === "rows" ? { rows: value.rows.map(() => ({ id: "not-the-batch" })) } : value,
          kind
        );
      });
    try {
      const f = fixture();
      payloadFree(f);
      f.input.db = rdb;
      f.setFailBatch(); // leaves the batch unknown, so the next run must replay it
      expect(await execute(f.input)).toBe("FAILED");
      spy.mockRestore();
      f.input = { ...f.input, taskId: "task-replay" };
      f.calls.length = 0;
      expect(await execute(f.input)).toBe("FAILED");
      // Stopped before the provider was asked to replay anything.
      expect(f.calls).not.toContain("reconcile");
      expect(f.writes.every(batch => batch.records.every(record => (record.row as any).id !== "not-the-batch"))).toBe(
        true
      );
    } finally {
      spy.mockRestore();
      await rdb.close();
    }
  });

  it("a batch that is still unresolved when its rows expire blocks delivery with the recovery message", async () => {
    const main = new MemoryObjects(),
      retention = new MemoryObjects(),
      rdb = retentionDb(main, retention);
    try {
      const f = fixture();
      payloadFree(f);
      f.input.db = rdb;
      f.setFailBatch(); // the destination loses the response: the batch is left unknown
      expect(await execute(f.input)).toBe("FAILED");
      retention.objects.clear();
      f.input = { ...f.input, taskId: "task-after-expiry" }; // the next scheduled run starts recovery, as in production
      const result = await execute(f.input);
      expect(result).toBe("FAILED");
      expect((await task("task-after-expiry")).error).toContain("Saved sync data is missing or unreadable");
    } finally {
      await rdb.close();
    }
  });
});

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
      `UPDATE newjitsu.source_task SET metrics=jsonb_set(jsonb_set(metrics,'{reverseRecovery,startedAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text)),'{reverseRecovery,deadline}',to_jsonb('2000-01-03T00:00:00.000Z'::text))`
    );
    f.input.trigger = "recovery";
    f.input.recoveryOf = "task";
    f.input.taskId = "last-check";
    expect(await execute(f.input)).toBe("PENDING");
    expect((await task()).description).toContain("after 48 hours");
    expect((await task()).error).toBeNull();
    expect((await task()).metrics.reverseRecovery.suspended).toBe(true);
    expect((await control()).phase).toBe("batches_pending");
    expect((await durable()).batches.length).toBe(1);
    expect((await admin.query("SELECT 1 FROM newjitsu.source_task WHERE status='PENDING'")).rowCount).toBe(1);
    const expiredSchedule = (await task()).metrics.reverseRecovery;
    await admin.query(
      `UPDATE newjitsu.source_task SET metrics=jsonb_set(metrics,'{reverseRecovery,suspended}','false') WHERE task_id='task'`
    );
    f.input.taskId = "explicit-after-deadline";
    expect(await execute(f.input)).toBe("PENDING");
    expect((await task()).metrics.reverseRecovery).toEqual(expiredSchedule);
    expect(f.writes).toHaveLength(1);
    // A new extraction has its own deadline; it does not reopen this expired run.
    f.input.trigger = "manual";
    f.input.taskId = "manual-after-timeout";
    delete f.input.recoveryOf;
    expect(await execute(f.input)).toBe("PENDING");
    expect((await task()).status).toBe("PENDING");
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
  it("records lease contention without opening delivery persistence", async () => {
    const f = fixture();
    f.input.lease.acquire = async () => {
      throw new Error("Reverse sync already running");
    };
    expect(await execute(f.input)).toBe("FAILED");
    expect(await control()).toBeUndefined();
    expect(await task()).toMatchObject({ status: "FAILED" });
    const logs = (await admin.query("SELECT message FROM newjitsu.task_log WHERE task_id=$1", [f.input.taskId])).rows;
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toContain("Another worker is running this sync");
    expect(f.calls).toEqual([]);
  });
  it("does not overwrite an existing task when a duplicate worker loses admission", async () => {
    const f = fixture();
    expect(await execute(f.input)).toBe("COMPLETE");
    const before = await task();
    f.input.lease.acquire = async () => {
      throw new Error("Reverse sync already running");
    };
    expect(await execute(f.input)).toBe("FAILED");
    expect(await task()).toEqual(before);
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
      "2 baseline members; 1 new, 0 changed, 0 unchanged due for expiry refresh, 0 unconfirmed requiring refresh, 1 unchanged skipped, 1 to remove"
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
    expect(resumedLogs).toContain("2 baseline members; 1 new");
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
  describe("retention changed between startup and admission", () => {
    // The object storage is fixed from the startup configuration, but retention is outside the revision hash, so an
    // admitted configuration with a different retention bucket must not run with the old storage choice.
    const admitting = (startup: { bucket: string } | undefined, admitted: { bucket: string } | undefined) => {
      const f = fixture();
      f.input.config = { ...f.input.config, ...(startup ? { retention: startup } : {}) };
      f.input.admit = async () => ({
        ...f.input.config,
        ...(admitted ? { retention: admitted } : { retention: undefined }),
      });
      return f;
    };
    it.each([
      // The only bucket a run may name is its own workspace's (the fixture's workspace is "workspace").
      ["enabled after startup", undefined, { bucket: "jitsu-retl-workspace" }],
      ["disabled after startup", { bucket: "jitsu-retl-workspace" }, undefined],
    ])(
      "refuses a run when retention was %s, before anything is constructed or sent",
      async (_name, startup, admitted) => {
        const f = admitting(startup, admitted);
        expect(await execute(f.input)).toBe("FAILED");
        expect(f.calls).toEqual(["lease", "release"]);
        expect((await task()).error).toContain("retention settings changed");
      }
    );
    it("refuses retention on a mirror run at admission, before anything is extracted or stored", async () => {
      // A mirror seals its full snapshot, with the projected provider data, before its first batch, so the per-batch guard
      // would be too late: the combination is refused up front.
      const f = fixture();
      f.input.config = {
        ...f.input.config,
        options: { ...f.input.config.options, mode: "mirror" },
        retention: { bucket: "jitsu-retl-workspace" },
      };
      expect(await execute(f.input)).toBe("FAILED");
      expect(f.calls).toEqual(["lease", "release"]);
      expect((await task()).error).toContain("snapshot of its data that cannot expire");
    });
    it("admits a run whose retention is unchanged, or absent on both sides", async () => {
      expect(await execute(admitting(undefined, undefined).input)).toBe("COMPLETE");
    });
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
      expect(await taskLogs("refresh")).toContain(
        "1 unchanged due for expiry refresh, 0 unconfirmed requiring refresh, 0 unchanged skipped"
      );
      expect(bodies[1]).toEqual(bodies[0]);
      expect(JSON.stringify(bodies)).not.toContain("Private.Person");
      await refresh(f, "refresh-resume", "refresh");
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(await taskLogs("refresh")).toContain(
        "1 unchanged due for expiry refresh, 0 unconfirmed requiring refresh, 0 unchanged skipped"
      );
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

describe("rejection reporting", () => {
  const rejectEverything = (f: ReturnType<typeof fixture>, code: string) => {
    const create = f.adapter.stream.createWriter;
    f.adapter.stream.createWriter = async ctx => {
      const writer = await create(ctx);
      writer.upsert = async batch => ({
        outcomes: batch.records.map(row => ({
          operationId: row.operationId,
          status: "rejected" as const,
          code,
          safeReason: "HTTP 422 with private-token in the body",
        })),
      });
      return writer;
    };
  };
  it("shows the rejection code in the task error and never the provider's text", async () => {
    const f = fixture();
    rejectEverything(f, "http_422");
    expect(await execute(f.input)).toBe("FAILED");
    const error = (await task()).error as string;
    expect(error).toContain("The destination rejected a row, so the sync stopped.");
    expect(error).toContain("Reason code: http_422.");
    expect(error).not.toContain("identifier mappings");
    expect(error).not.toContain("private-token");
    expect(await taskLogs("task")).not.toContain("private-token");
  });
  it("shows the rejection code when recovery of an unresolved batch finds a rejected row", async () => {
    const f = fixture();
    f.setFailBatch(); // the response was lost: the batch is left unresolved
    expect(await execute(f.input)).toBe("FAILED");
    const recovery = f.adapter.recovery!;
    // reconciliation learns the destination's answer: the row was rejected
    f.adapter.recovery = providerState => ({
      ...recovery(providerState),
      reconcileBatch: async batch => ({
        outcomes: batch.records.map(row => ({
          operationId: row.operationId,
          status: "rejected" as const,
          code: "http_422",
          safeReason: "HTTP 422 with private-token in the body",
        })),
      }),
    });
    f.input = { ...f.input, taskId: "recovery" };
    expect(await execute(f.input)).toBe("FAILED");
    const error = (await task("recovery")).error as string;
    expect(error).toContain("The destination rejected a row, so the sync stopped.");
    expect(error).toContain("Reason code: http_422.");
    expect(error).not.toContain("private-token");
  });
  it("shows the rejection code when a mirror run's recovery finds a rejected row", async () => {
    const f = fixture();
    f.input.config.options = { ...f.input.config.options, mode: "mirror" };
    f.setFailBatch();
    expect(await execute(f.input)).toBe("FAILED");
    const recovery = f.adapter.recovery!;
    f.adapter.recovery = providerState => ({
      ...recovery(providerState),
      reconcileBatch: async batch => ({
        outcomes: batch.records.map(row => ({
          operationId: row.operationId,
          status: "rejected" as const,
          code: "http_422",
          safeReason: "HTTP 422 with private-token in the body",
        })),
      }),
    });
    f.input = { ...f.input, taskId: "recovery" };
    expect(await execute(f.input)).toBe("FAILED");
    const error = (await task("recovery")).error as string;
    expect(error).toContain("The destination rejected a row, so the sync stopped.");
    expect(error).toContain("Reason code: http_422.");
    expect(error).not.toContain("private-token");
  });
  it("the run that cleans up after a rejected batch was acknowledged still shows its reason code", async () => {
    const f = fixture();
    f.setFailBatch(); // unresolved batch
    expect(await execute(f.input)).toBe("FAILED");
    const recovery = f.adapter.recovery!;
    f.adapter.recovery = providerState => ({
      ...recovery(providerState),
      reconcileBatch: async batch => ({
        outcomes: batch.records.map(row => ({
          operationId: row.operationId,
          status: "rejected" as const,
          code: "http_422",
          safeReason: "HTTP 422 with private-token in the body",
        })),
      }),
    });
    f.input = { ...f.input, taskId: "recovery-1" };
    expect(await execute(f.input)).toBe("FAILED"); // the rejection is acknowledged durably, with its code shown
    // The next run finds the rejection already saved: it cleans up and restarts, and must not lose the code. Raising here
    // again would make recovery fail every time, so the code is added to the cleanup message instead.
    f.input = { ...f.input, taskId: "recovery-2" };
    f.calls.length = 0;
    expect(await execute(f.input)).toBe("FAILED");
    expect(f.calls).toContain("reconcileAbort");
    const error = (await task("recovery-2")).error as string;
    expect(error).toContain("Recovery completed cleanup; next run will restart extraction");
    expect(error).toContain("Reason code: http_422.");
    expect(error).not.toContain("private-token");
    // and the sync is not stuck: the run after that completes (the destination is healthy again)
    const create = f.adapter.stream.createWriter;
    f.adapter.stream.createWriter = async ctx => {
      const writer = await create(ctx);
      writer.upsert = async batch => accepted(batch);
      return writer;
    };
    f.input = { ...f.input, taskId: "recovery-3" };
    expect(await execute(f.input)).toBe("COMPLETE");
  });
  it("shows the rejection code for a mirror run too", async () => {
    const f = fixture();
    rejectEverything(f, "http_422");
    f.input.config.options = { ...f.input.config.options, mode: "mirror" };
    expect(await execute(f.input)).toBe("FAILED");
    const error = (await task()).error as string;
    expect(error).toContain("The destination rejected a row, so the sync stopped.");
    expect(error).toContain("Reason code: http_422.");
    expect(error).not.toContain("private-token");
  });
  it("drops a malformed code instead of showing it", async () => {
    const f = fixture();
    rejectEverything(f, "Bearer private-token");
    expect(await execute(f.input)).toBe("FAILED");
    const error = (await task()).error as string;
    expect(error).toContain("The destination rejected a row, so the sync stopped.");
    expect(error).not.toContain("Reason code");
    expect(error).not.toContain("private-token");
  });
  it("describes delivery counts without Google-specific wording", async () => {
    const f = fixture();
    expect(await execute(f.input)).toBe("COMPLETE");
    const logs = await taskLogs("task");
    expect(logs).toContain("Delivery counts describe records the destination's API accepted");
    expect(logs).not.toContain("Google");
  });
});

describe("webhook destination through the runner", () => {
  let server: http.Server;
  let received: any[];
  let status: number;
  beforeEach(async () => {
    received = [];
    status = 200;
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
        res.statusCode = status;
        res.end();
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  });
  afterEach(() => new Promise<void>(resolve => server.close(() => resolve())));

  function webhookFixture() {
    const f = fixture();
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    f.input.config.destination = { destinationType: "webhook", url, method: "POST" };
    f.input.config.options = {
      ...f.input.config.options,
      stream: "rows",
      mode: "upsert",
      mapping: { id: "id" },
      streamOptions: { deliveryAttested: true, allowInsecureHttp: true },
    };
    f.setRows([{ id: "a" }, { id: "b" }, { id: "c" }]);
    // The test server is on loopback, which the real guard refuses; everything else is the production delivery path.
    const deps = {
      ...defaultDeliveryDeps,
      send: createGuardedRequest({ isBlocked: () => false }),
      sleep: async () => {},
    };
    f.input.adapters = new Map([["webhook", cfg => createWebhookRuntime(cfg as any, undefined, deps)]]);
    return f;
  }

  it("delivers every row once, in the documented envelope", async () => {
    const f = webhookFixture();
    expect(await execute(f.input)).toBe("COMPLETE");
    const records = received.flatMap(r => r.body.records);
    expect(records.map((r: any) => r.data.id).sort()).toEqual(["a", "b", "c"]);
    expect(received[0].body).toMatchObject({ syncId: "sync" });
    expect(records.every((r: any) => r.operation === "upsert" && r.idempotencyKey)).toBe(true);
  });

  it("a long URL (for example one that carries a token in its query string) does not stop the run from starting", async () => {
    const f = webhookFixture();
    const long = `${f.input.config.destination.url}?token=${"t".repeat(700)}`;
    f.input.config.destination = { ...f.input.config.destination, url: long };
    expect(await execute(f.input)).toBe("COMPLETE");
    expect(received.flatMap(r => r.body.records).length).toBe(3);
  });

  it("stops at a rejected record with its reason code, then re-sends the same keys on the next run", async () => {
    const f = webhookFixture();
    status = 400;
    expect(await execute(f.input)).toBe("FAILED");
    expect((await task()).error).toContain("Reason code: http_400");
    const firstKeys = received.flatMap(r => r.body.records.map((x: any) => x.idempotencyKey)).sort();
    received.length = 0;
    status = 200;
    f.input = { ...f.input, taskId: "task-2" };
    expect(await execute(f.input)).toBe("COMPLETE");
    const secondKeys = received.flatMap(r => r.body.records.map((x: any) => x.idempotencyKey)).sort();
    expect([...new Set(secondKeys)]).toEqual([...new Set(firstKeys)]);
  });

  it("an unreachable endpoint fails the run with a readable code and no thrown crash", async () => {
    const f = webhookFixture();
    await new Promise<void>(resolve => server.close(() => resolve()));
    server = http.createServer();
    expect(await execute(f.input)).toBe("FAILED");
    expect((await task()).error).toMatch(/Reason code: (unconfirmed|connection_error)/);
  });
  describe("Postgres column types arrive as plain JSON", () => {
    // [name, column type, value expression, expected JSON value as received by the endpoint]
    // Expectations were reviewed one by one against the plan's type table (H11): types that fail a run without
    // conversion (float NaN/Infinity, interval, bytea) must be converted; everything else must arrive unchanged.
    const cases: Array<[string, string, string, unknown]> = [
      ["int4", "int4", "42", 42],
      ["int8", "int8", "123456789012345678", "123456789012345678"],
      ["numeric", "numeric", "1.50", "1.50"],
      ["float8", "float8", "1.25", 1.25],
      ["float4", "float4", "1.5", 1.5],
      ["float8 NaN", "float8", "'NaN'", "NaN"],
      ["float8 Infinity", "float8", "'Infinity'", "Infinity"],
      ["float8 -Infinity", "float8", "'-Infinity'", "-Infinity"],
      ["float4 NaN", "float4", "'NaN'", "NaN"],
      ["numeric NaN", "numeric", "'NaN'", "NaN"],
      ["bool", "bool", "true", true],
      ["text", "text", "'héllo'", "héllo"],
      ["char(3)", "char(3)", "'a'", "a  "],
      ["null", "text", "NULL", null],
      ["date", "date", "'2026-01-01'", "2026-01-01"],
      ["timestamp", "timestamp", "'2026-01-01 12:00:00.123456'", "2026-01-01 12:00:00.123456"],
      ["timestamptz", "timestamptz", "'2026-01-01 12:00:00+00'", "2026-01-01 12:00:00+00"],
      ["timestamptz infinity", "timestamptz", "'infinity'", "infinity"],
      ["time", "time", "'12:34:56'", "12:34:56"],
      ["interval", "interval", "'1 day 02:03:04'", "P0Y0M1DT2H3M4S"],
      ["uuid", "uuid", "'11111111-2222-3333-4444-555555555555'", "11111111-2222-3333-4444-555555555555"],
      ["json", "json", `'{"a":[1,2]}'`, { a: [1, 2] }],
      ["jsonb", "jsonb", `'{"a":[1,2]}'`, { a: [1, 2] }],
      ["int[]", "int[]", "ARRAY[1,2,3]", [1, 2, 3]],
      ["text[]", "text[]", "ARRAY['a','b']", ["a", "b"]],
      ["int8[]", "int8[]", "ARRAY[9007199254740993]", ["9007199254740993"]],
      ["numeric[]", "numeric[]", "ARRAY[1.5,2.5]", [1.5, 2.5]],
      ["bytea", "bytea", "'\\xdeadbeef'", "3q2+7w=="],
      ["bytea[]", "bytea[]", "ARRAY['\\xde'::bytea]", ["3g=="]],
      ["interval[]", "interval[]", "ARRAY['1 day'::interval]", ["P0Y0M1DT0H0M0S"]],
      ["float8[] with NaN", "float8[]", "ARRAY['NaN'::float8, 1]", ["NaN", 1]],
      ["jsonb[]", "jsonb[]", `ARRAY['{"a":1}'::jsonb]`, [{ a: 1 }]],
      [
        "2-D int[]",
        "int[]",
        "ARRAY[[1,2],[3,4]]",
        [
          [1, 2],
          [3, 4],
        ],
      ],
      ["inet", "inet", "'10.0.0.1'", "10.0.0.1"],
      ["cidr", "cidr", "'10.0.0.0/8'", "10.0.0.0/8"],
      ["macaddr", "macaddr", "'08:00:2b:01:02:03'", "08:00:2b:01:02:03"],
      ["money", "money", "'$1.50'", "$1.50"],
      ["bit(3)", "bit(3)", "B'101'", "101"],
      ["xml", "xml", "'<a/>'", "<a/>"],
      ["tsvector", "tsvector", "'a:1 b:2'", "'a':1 'b':2"],
      ["int4range", "int4range", "'[1,5)'", "[1,5)"],
      ["point", "point", "'(1,2)'", { x: 1, y: 2 }],
      ["box", "box", "'((1,1),(2,2))'", "(2,2),(1,1)"],
    ];
    let n = 0;
    it.each(cases)("%s", async (name, type, expr, expected) => {
      const table = `webhook_type_${++n}`;
      await admin.query(
        `CREATE TABLE ${table} (id int PRIMARY KEY, v ${type}); INSERT INTO ${table} VALUES (1, ${expr})`
      );
      const f = webhookFixture();
      f.input.config.warehouse = {
        destinationType: "postgres",
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: "runner_test",
        username: "postgres",
        password: "test",
        sslMode: "disable",
      };
      f.input.reader = createWarehouseReader as any;
      f.input.config.model = { ...f.input.config.model, query: `SELECT id, v FROM ${table}`, primaryKey: ["id"] };
      f.input.config.options = { ...f.input.config.options, mapping: { id: "id", v: "v" } };
      expect(await execute(f.input)).toBe("COMPLETE");
      const record = received.flatMap(r => r.body.records)[0];
      expect(record.data.id).toBe(1);
      // Whatever arrives must survive a JSON round trip unchanged, i.e. be plain JSON.
      expect(JSON.parse(JSON.stringify(record.data))).toEqual(record.data);
      expect(record.data.v).toEqual(expected);
    });
  });
  describe("ClickHouse column types arrive as plain JSON", () => {
    let ch: StartedTestContainer;
    const chRun = async (query: string) => {
      const response = await fetch(`http://${ch.getHost()}:${ch.getMappedPort(8123)}/?user=default&password=pw`, {
        method: "POST",
        body: query,
      });
      if (!response.ok) throw new Error(await response.text());
    };
    beforeAll(async () => {
      ch = await new GenericContainer("clickhouse/clickhouse-server:25.4-alpine")
        .withExposedPorts(8123)
        .withEnvironment({ CLICKHOUSE_DB: "default", CLICKHOUSE_USER: "default", CLICKHOUSE_PASSWORD: "pw" })
        .withWaitStrategy(Wait.forHttp("/ping", 8123).forStatusCode(200))
        .withStartupTimeout(120_000)
        .start();
    }, 150_000);
    afterAll(async () => {
      await ch?.stop();
    });
    // [name, column type, value expression, expected JSON value as received by the endpoint]
    const cases: Array<[string, string, string, unknown]> = [
      ["Int64", "Int64", "9223372036854775807", "9223372036854775807"],
      ["UInt64", "UInt64", "18446744073709551615", "18446744073709551615"],
      ["Int128", "Int128", "170141183460469231731687303715884105727", "170141183460469231731687303715884105727"],
      [
        "Int256",
        "Int256",
        "57896044618658097711785492504343953926634992332820282019728792003956564819967",
        "57896044618658097711785492504343953926634992332820282019728792003956564819967",
      ],
      ["Decimal(18,4)", "Decimal(18,4)", "1.2345", "1.2345"],
      ["Decimal256(10)", "Decimal256(10)", "123.456", "123.456"],
      ["Float64", "Float64", "1.5", 1.5],
      ["Float64 nan", "Float64", "nan", null],
      ["Float64 inf", "Float64", "inf", null],
      ["Date", "Date", "'2026-01-01'", "2026-01-01"],
      ["Date32", "Date32", "'2026-01-01'", "2026-01-01"],
      ["DateTime", "DateTime('UTC')", "'2026-01-01 12:00:00'", "2026-01-01 12:00:00"],
      ["DateTime64(6)", "DateTime64(6,'UTC')", "'2026-01-01 12:00:00.123456'", "2026-01-01 12:00:00.123456"],
      ["String", "String", "'héllo'", "héllo"],
      ["FixedString(3)", "FixedString(3)", "'abc'", "abc"],
      ["UUID", "UUID", "'11111111-2222-3333-4444-555555555555'", "11111111-2222-3333-4444-555555555555"],
      ["Bool", "Bool", "true", true],
      ["Enum8", "Enum8('a'=1,'b'=2)", "'a'", "a"],
      ["Enum16", "Enum16('x'=1000,'y'=2)", "'x'", "x"],
      ["LowCardinality(String)", "LowCardinality(String)", "'lc'", "lc"],
      ["Nullable(String) NULL", "Nullable(String)", "NULL", null],
      ["Array(Int64)", "Array(Int64)", "[1,2,9223372036854775807]", ["1", "2", "9223372036854775807"]],
      ["Array(String)", "Array(String)", "['x']", ["x"]],
      ["Array(Nullable(Int64))", "Array(Nullable(Int64))", "[1,NULL]", ["1", null]],
      ["Tuple(Int64,String)", "Tuple(Int64, String)", "(7,'t')", ["7", "t"]],
      ["named Tuple", "Tuple(a Int64, b String)", "(1,'t')", { a: "1", b: "t" }],
      ["Map(String,Int64)", "Map(String, Int64)", "map('k', 5)", { k: "5" }],
      ["IPv4", "IPv4", "'10.0.0.1'", "10.0.0.1"],
      ["IPv6", "IPv6", "'::1'", "::1"],
      ["Variant", "Variant(Int64, String)", "5", "5"],
    ];
    let n = 0;
    it.each(cases)("%s", async (name, type, expr, expected) => {
      const table = `webhook_type_${++n}`;
      await chRun(`CREATE TABLE ${table} (id UInt32, v ${type}) ENGINE = MergeTree ORDER BY id`);
      await chRun(`INSERT INTO ${table} VALUES (1, ${expr})`);
      const f = webhookFixture();
      f.input.config.warehouse = {
        destinationType: "clickhouse",
        protocol: "http",
        hosts: [`${ch.getHost()}:${ch.getMappedPort(8123)}`],
        database: "default",
        username: "default",
        password: "pw",
      };
      f.input.reader = createWarehouseReader as any;
      f.input.config.model = { ...f.input.config.model, query: `SELECT id, v FROM ${table}`, primaryKey: ["id"] };
      f.input.config.options = { ...f.input.config.options, mapping: { id: "id", v: "v" } };
      expect(await execute(f.input)).toBe("COMPLETE");
      const record = received.flatMap(r => r.body.records)[0];
      expect(JSON.parse(JSON.stringify(record.data))).toEqual(record.data);
      expect(record.data.v).toEqual(expected);
    });
    it("Nested columns arrive as arrays when aliased in the model SQL", async () => {
      await chRun(
        `CREATE TABLE webhook_nested (id UInt32, n Nested(a Int64, b String)) ENGINE = MergeTree ORDER BY id`
      );
      await chRun("INSERT INTO webhook_nested (id, `n.a`, `n.b`) VALUES (1, [1,2], ['p','q'])");
      const f = webhookFixture();
      f.input.config.warehouse = {
        destinationType: "clickhouse",
        protocol: "http",
        hosts: [`${ch.getHost()}:${ch.getMappedPort(8123)}`],
        database: "default",
        username: "default",
        password: "pw",
      };
      f.input.reader = createWarehouseReader as any;
      f.input.config.model = {
        ...f.input.config.model,
        query: "SELECT id, `n.a` AS n_a, `n.b` AS n_b FROM webhook_nested",
        primaryKey: ["id"],
      };
      f.input.config.options = { ...f.input.config.options, mapping: { id: "id", n_a: "n_a", n_b: "n_b" } };
      expect(await execute(f.input)).toBe("COMPLETE");
      expect(received.flatMap(r => r.body.records)[0].data).toEqual({ id: 1, n_a: ["1", "2"], n_b: ["p", "q"] });
    });
  });
});

describe("webhook delivery under faults", () => {
  const ROWS = Number(process.env.WEBHOOK_SOAK_ROWS ?? 3000);
  // The suite's console output is swallowed; WEBHOOK_REPORT=<file> collects the measurements instead.
  const report = (line: string) => {
    if (process.env.WEBHOOK_REPORT) require("node:fs").appendFileSync(process.env.WEBHOOK_REPORT, `${line}\n`);
  };
  const secret = "soak-secret";
  type Action =
    | { kind: "ok" }
    | { kind: "status"; status: number; retryAfter?: string }
    | { kind: "reset"; processed: boolean }
    | { kind: "slow"; ms: number }
    | { kind: "hang"; processed: boolean };
  interface Info {
    ids: number[];
    request: number;
  }
  let server: http.Server;
  let sockets: Set<import("node:net").Socket>;
  const state = {
    delivered: new Map<string, number>(),
    ids: new Map<number, number>(),
    requests: 0,
    badSignatures: 0,
    behaviour: (_info: Info): Action => ({ kind: "ok" }),
    onProcessed: (_uniqueIds: number) => {},
  };
  const reset = () => {
    state.delivered.clear();
    state.ids.clear();
    state.requests = 0;
    state.badSignatures = 0;
    state.behaviour = () => ({ kind: "ok" });
    state.onProcessed = () => {};
  };
  // Small deterministic generator so a failing run can be reproduced.
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  beforeEach(async () => {
    reset();
    sockets = new Set();
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        const timestamp = String(req.headers["jitsu-signature-timestamp"]);
        const expected = createHmac("sha256", secret).update(`${timestamp}.${text}`).digest("hex");
        if (req.headers["jitsu-signature"] !== expected) state.badSignatures++;
        const records = JSON.parse(text).records as { key: string; idempotencyKey: string; data: { id: number } }[];
        const action = state.behaviour({ ids: records.map(r => r.data.id), request: ++state.requests });
        const process = () => {
          for (const record of records) {
            state.delivered.set(record.idempotencyKey, (state.delivered.get(record.idempotencyKey) ?? 0) + 1);
            state.ids.set(record.data.id, (state.ids.get(record.data.id) ?? 0) + 1);
          }
          state.onProcessed(state.ids.size);
        };
        switch (action.kind) {
          case "ok":
            process();
            res.statusCode = 200;
            res.end();
            break;
          case "slow":
            process();
            setTimeout(() => {
              res.statusCode = 200;
              res.end();
            }, action.ms);
            break;
          case "status":
            res.statusCode = action.status;
            if (action.retryAfter) res.setHeader("retry-after", action.retryAfter);
            res.end();
            break;
          case "reset":
            if (action.processed) process();
            req.socket.destroy();
            break;
          case "hang":
            if (action.processed) process();
            break;
        }
      });
    });
    server.on("connection", socket => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  });
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  function soak(rows = ROWS) {
    const f = fixture();
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    f.input.config.destination = {
      destinationType: "webhook",
      url,
      method: "POST",
      signatureMethod: "hmac",
      signatureSecret: secret,
    };
    f.input.config.model = {
      ...f.input.config.model,
      query: "SELECT id, name FROM source",
      primaryKey: ["id"],
      cursor: { column: "id", type: "number" },
    } as any;
    f.input.config.options = {
      ...f.input.config.options,
      stream: "rows",
      mode: "upsert",
      mapping: { id: "id", name: "name" },
      checkpointEvery: 5000,
      streamOptions: { deliveryAttested: true, allowInsecureHttp: true, recordsPerRequest: 50, concurrency: 2 },
    };
    const deps = {
      ...defaultDeliveryDeps,
      send: createGuardedRequest({ isBlocked: () => false }),
      sleep: async () => {},
    };
    f.input.adapters = new Map([["webhook", cfg => createWebhookRuntime(cfg as any, undefined, deps)]]);
    f.input.reader = () =>
      ({
        sql: {} as any,
        columns: async () => [],
        preview: async () => ({ rows: [], columns: [], truncated: false }),
        close: async () => {},
        stream: async function* (_model: any, after: any, signal: AbortSignal) {
          for (let id = after ? Number(after.value) + 1 : 1; id <= rows; id++) {
            signal.throwIfAborted();
            yield {
              row: { id, name: `user-${id}` },
              deleted: false,
              checkpoint: { value: String(id), primaryKeyValues: [String(id)] },
            };
          }
        },
      } as any);
    let run = 0;
    const next = () => {
      run++;
      f.input = { ...f.input, taskId: `soak-${run}`, controller: new AbortController() };
      return f.input;
    };
    return { f, next, rows };
  }
  const deliveredEverything = (rows: number) => {
    const missing: number[] = [];
    for (let id = 1; id <= rows && missing.length < 5; id++) if (!state.ids.has(id)) missing.push(id);
    return missing;
  };
  const duplicates = () => [...state.delivered.values()].reduce((sum, count) => sum + count - 1, 0);
  // After a run is interrupted mid-request the batch is left uncertain. The next scheduled run fails once with the
  // core's "reconcile before retrying" error and the one after it recovers (no human step). Returns each run's result
  // and the failed runs' task errors.
  const continueAfterInterruption = async (next: () => ExecuteOptions) => {
    const results: string[] = [];
    const errors: string[] = [];
    while (results.at(-1) !== "COMPLETE" && results.length < 4) {
      const input = next();
      results.push(await execute(input));
      if (results.at(-1) === "FAILED") errors.push(String((await task(input.taskId)).error));
    }
    return { results, errors };
  };

  it("delivers every row exactly once-or-more under 503, 429, resets and slow responses, with valid signatures", async () => {
    const random = seeded(7);
    state.behaviour = () => {
      const r = random();
      if (r < 0.015) return { kind: "status", status: 503 };
      if (r < 0.02) return { kind: "status", status: 429, retryAfter: "0" };
      if (r < 0.025) return { kind: "reset", processed: false };
      if (r < 0.035) return { kind: "reset", processed: true };
      if (r < 0.045) return { kind: "slow", ms: 30 };
      return { kind: "ok" };
    };
    const { f, rows } = soak();
    expect(await execute(f.input)).toBe("COMPLETE");
    expect(deliveredEverything(rows)).toEqual([]);
    expect(state.ids.size).toBe(rows);
    expect(state.badSignatures).toBe(0);
    // Resets after processing show up as repeats with the same idempotency key, never as different keys for one row.
    expect(new Set([...state.delivered.keys()]).size).toBe(rows);
    report(`SOAK rows=${rows} requests=${state.requests} duplicates=${duplicates()}`);
  }, 600_000);

  it("a poison record stops the run with its code; after the endpoint is fixed the next run delivers everything and re-sends at most one checkpoint", async () => {
    const { f, next, rows } = soak();
    const poison = Math.floor(rows * 0.6);
    state.behaviour = ({ ids }) => (ids.includes(poison) ? { kind: "status", status: 400 } : { kind: "ok" });
    expect(await execute(next())).toBe("FAILED");
    expect((await task("soak-1")).error).toContain("Reason code: http_400");
    expect(state.ids.has(poison)).toBe(false);
    const deliveredBefore = state.ids.size;
    state.behaviour = () => ({ kind: "ok" });
    expect(await execute(next())).toBe("COMPLETE");
    expect(deliveredEverything(rows)).toEqual([]);
    expect(state.badSignatures).toBe(0);
    const resent = duplicates();
    report(`POISON rows=${rows} poison=${poison} deliveredBeforeFix=${deliveredBefore} resent=${resent}`);
    expect(resent).toBeLessThanOrEqual(5000 + 4 * 50);
  }, 600_000);

  it("cancelling mid-run and running again delivers every row", async () => {
    const { next, rows } = soak();
    const run = next();
    const cutoff = Math.floor(rows * 0.3);
    state.onProcessed = unique => {
      if (unique >= cutoff) run.controller.abort();
    };
    expect(await execute(run)).toBe("CANCELLED");
    expect(state.ids.size).toBeLessThan(rows);
    state.onProcessed = () => {};
    const { results, errors } = await continueAfterInterruption(next);
    report(`CANCEL results=${results.join(",")} errors=${JSON.stringify([...new Set(errors)])}`);
    expect(results.at(-1)).toBe("COMPLETE");
    expect(results.filter(result => result === "FAILED").length).toBeLessThanOrEqual(1);
    expect(deliveredEverything(rows)).toEqual([]);
    report(`CANCEL rows=${rows} cutoff=${cutoff} duplicates=${duplicates()}`);
  }, 600_000);

  it("an abort while a request is in flight (endpoint processed it, never answered) is replayed with the same keys and delivers every row", async () => {
    const { next, rows } = soak();
    const run = next();
    const hangAt = Math.floor(rows / 2);
    let hung = false;
    state.behaviour = ({ ids }) => {
      if (!hung && ids.includes(hangAt)) {
        hung = true;
        setTimeout(() => run.controller.abort(), 100);
        return { kind: "hang", processed: true };
      }
      return { kind: "ok" };
    };
    expect(await execute(run)).not.toBe("COMPLETE");
    expect(state.ids.has(hangAt)).toBe(true);
    const { results, errors } = await continueAfterInterruption(next);
    report(`INFLIGHT results=${results.join(",")} errors=${JSON.stringify([...new Set(errors)])}`);
    expect(results.at(-1)).toBe("COMPLETE");
    expect(results.filter(result => result === "FAILED").length).toBeLessThanOrEqual(1);
    expect(deliveredEverything(rows)).toEqual([]);
    const repeated = [...state.delivered.entries()].filter(([, count]) => count > 1);
    expect(repeated.length).toBeGreaterThan(0);
    report(`INFLIGHT rows=${rows} hangAt=${hangAt} duplicates=${duplicates()}`);
  }, 600_000);
});

describe("webhook SSRF protection through the runner (real address guard, nothing bypassed)", () => {
  let server: http.Server;
  let hits: string[];
  let redirectTo: string | undefined;
  beforeEach(async () => {
    hits = [];
    redirectTo = undefined;
    server = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      req.resume();
      if (redirectTo) {
        res.statusCode = 302;
        res.setHeader("location", redirectTo);
      }
      res.end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  });
  afterEach(() => new Promise<void>(resolve => server.close(() => resolve())));

  function syncTo(url: string, realGuard = true) {
    const f = fixture();
    f.input.config.destination = { destinationType: "webhook", url, method: "POST" };
    f.input.config.options = {
      ...f.input.config.options,
      stream: "rows",
      mode: "upsert",
      mapping: { id: "id" },
      streamOptions: { deliveryAttested: true, allowInsecureHttp: true },
    };
    f.setRows([{ id: "a" }]);
    // Production deliver path with its real guard; only the wait between retries is skipped.
    const deps = {
      ...defaultDeliveryDeps,
      sleep: async () => {},
      ...(realGuard ? {} : { send: createGuardedRequest({ isBlocked: (address: string) => address !== "127.0.0.1" }) }),
    };
    f.input.adapters = new Map([["webhook", cfg => createWebhookRuntime(cfg as any, undefined, deps)]]);
    return f;
  }

  const blocked = (port: number) => [
    `http://127.0.0.1:${port}/hook`,
    `http://localhost:${port}/hook`,
    `http://[::1]:${port}/hook`,
    `http://[::ffff:127.0.0.1]:${port}/hook`,
    `http://[::ffff:7f00:1]:${port}/hook`,
    `http://2130706433:${port}/hook`,
    `http://0x7f.1:${port}/hook`,
    `http://0.0.0.0:${port}/hook`,
    `http://[::]:${port}/hook`,
    "http://169.254.169.254/latest/meta-data/",
    "http://[fe80::1]/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://224.0.0.1/",
    "http://[64:ff9b::7f00:1]/",
    "http://[fd00::1]/",
  ];

  it("refuses loopback, link-local, private, CGNAT, multicast, mapped and NAT64 targets with a clear code and no request", async () => {
    const port = (server.address() as AddressInfo).port;
    for (const url of blocked(port)) {
      const f = syncTo(url);
      f.input.taskId = `ssrf-${Math.random().toString(36).slice(2)}`;
      expect(await execute(f.input), url).toBe("FAILED");
      const error = String((await task(f.input.taskId)).error);
      expect(error, url).toContain("Reason code: blocked_address");
      expect(error, url).not.toContain("127.0.0.1");
      await admin.query(
        "TRUNCATE newjitsu.reverse_sync_control,newjitsu.reverse_sync_target_owner,newjitsu.source_state,newjitsu.source_task,newjitsu.task_log"
      );
    }
    expect(hits).toEqual([]);
  }, 300_000);

  it("does not follow a redirect to an internal address", async () => {
    redirectTo = "http://169.254.169.254/latest/meta-data/";
    const f = syncTo(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, false);
    expect(await execute(f.input)).toBe("FAILED");
    expect(String((await task()).error)).toContain("Reason code: redirect_refused");
    expect(hits).toEqual(["POST /hook"]);
  });
});
