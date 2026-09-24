import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { JsonObject, ReverseEtlContext, WriteBatch } from "@jitsu/protocols/reverse-etl";
import type { DestinationServices } from "@jitsu/protocols/reverse-etl-runtime";
import { createMetaAudience, normalizeMetaAudience, projectMetaAudience } from "../src/functions/facebook/audience";
import { createMetaConversions } from "../src/functions/facebook/conversions";
import { metaSessionId } from "../src/functions/facebook/delivery";
import { metaNormalize, metaHashes } from "../src/functions/facebook/identifiers";
import {
  MetaAudienceOptions,
  MetaAudienceRow,
  MetaConversionRow,
  validateMetaReverseSettings,
} from "../src/functions/facebook/reverse-meta";
import { reverseDestinationMetadata } from "../src/reverse-etl/catalog";
import { createBufferedSyncStore, contentHash } from "../src/reverse-etl/identity";
import { requiresManualReconciliation } from "../src/reverse-etl/failure";
import { runReverseEtl } from "../src/reverse-etl/run";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const credentials = { accessToken: "secret-meta-token" };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture(stream: "audience" | "conversions" = "audience", settings: Record<string, any> = {}) {
  const fetch = vi.fn(async (_url: string, _init: any) => response({}));
  const log = vi.fn(async (_message: string) => {});
  const services = { fetch, log, signal: new AbortController().signal, getAccessToken: vi.fn() } as DestinationServices;
  const options = MetaAudienceOptions.parse({
    accountId: "123",
    audience: { kind: "existing", audienceId: "456" },
    ...(stream === "audience" ? settings : {}),
  });
  const adapter =
    stream === "audience"
      ? createMetaAudience(credentials, options as JsonObject, "456", false, services, async () => {})
      : createMetaConversions(
          credentials,
          { pixelId: "789", actionSource: "physical_store", eventName: "Lead", ...settings },
          "sync",
          services
        );
  const ctx = {
    credentials: adapter.credentials,
    options: adapter.options,
    syncId: "sync",
    taskId: "task",
    logicalRunId: "run",
    configRevision: "revision",
    targetIdentity: adapter.targetIdentity,
    mode: "upsert",
    fullRefresh: true,
    signal: services.signal,
    fetch,
    store: createBufferedSyncStore(),
    log: { info() {}, warn() {}, error() {}, debug() {} },
    delivery: {},
  } as unknown as ReverseEtlContext<JsonObject, JsonObject>;
  const batch = (input: Record<string, unknown> = { email: "Alice@Example.COM" }): WriteBatch<JsonObject> => ({
    batchId: "batch",
    records: [
      {
        operationId: "op",
        key: "a".repeat(64),
        sourceSequence: 1,
        row: adapter.stream.rowType.parse({
          ...(stream === "conversions" ? { __sourceKey: "a".repeat(64) } : {}),
          ...input,
        }),
      },
    ],
  });
  const ack = (batch: WriteBatch<JsonObject>, action: "upsert" | "remove" = "upsert") =>
    response({
      audience_id: "456",
      session_id: String(metaSessionId(ctx, batch, action)),
      num_received: batch.records.length,
      num_invalid_entries: 0,
    });
  return { adapter, ctx, fetch, log, batch, ack, options, services };
}

describe("Meta stream metadata and normalization", () => {
  it("exposes two isolated forms with schema-backed mappings and no internal source-key control", () => {
    const streams = reverseDestinationMetadata.get("facebook-conversions")!.streams;
    expect(streams.map(s => s.id)).toEqual(["audience", "conversions"]);
    for (const stream of streams) {
      const schema = stream.id === "audience" ? MetaAudienceRow : MetaConversionRow;
      for (const field of stream.fields(stream.defaults())) {
        const names =
          field.editor === "identifier" ? [field.raw, field.hashed] : field.editor === "mapping" ? [field.field] : [];
        for (const name of names) {
          expect(name in schema.shape).toBe(true);
          expect(name).not.toBe("__sourceKey");
        }
      }
    }
    expect(streams[1].defaults()).toMatchObject({ mode: "upsert", mapping: {}, streamOptions: { pixelId: "" } });
    const fields = streams[0].fields(streams[0].defaults());
    const selector = fields.find(f => f.name === "Audience")!;
    if (selector.editor !== "select") throw new Error("missing selector");
    expect(selector.change("existing")).toMatchObject({
      mode: "upsert",
      streamOptions: { audience: { kind: "existing", audienceId: "" } },
    });
  });
  it("rejects unsupported streams/modes and arbitrary existing mirror baselines", () => {
    const f = fixture();
    expect(() => validateMetaReverseSettings({ stream: "unknown", mode: "upsert", streamOptions: {} }, {})).toThrow(
      "Unsupported"
    );
    expect(() =>
      validateMetaReverseSettings({ stream: "audience", mode: "mirror", streamOptions: f.options }, {})
    ).toThrow("managed audience");
    expect(() =>
      validateMetaReverseSettings(
        { stream: "conversions", mode: "upsert", streamOptions: { pixelId: "789" } },
        { deleteColumn: "deleted" }
      )
    ).toThrow("insert mode");
    expect(() =>
      validateMetaReverseSettings(
        {
          stream: "audience",
          mode: "mirror",
          streamOptions: { ...f.options, audience: { kind: "managed", name: "Test" } },
        },
        {}
      )
    ).toThrow("exclusive");
  });
  it("uses Meta-specific normalization, preserves supplied hashes and rejects ambiguous raw/hash pairs", () => {
    expect(metaNormalize("email", " Alice.Test@Gmail.com ")).toBe("alice.test@gmail.com");
    expect(metaNormalize("phone", "+1 (415) 555-2671")).toBe("14155552671");
    expect(metaNormalize("birthMonth", "3")).toBe("03");
    expect(metaNormalize("postalCode", "12345-6789")).toBe("12345");
    expect(metaNormalize("gender", "Female")).toBe("f");
    expect(metaHashes({ email: ["A@EXAMPLE.COM", "a@example.com"] }, "email", "hashedEmail")).toEqual([
      hash("a@example.com"),
    ]);
    expect(metaHashes({ hashedEmail: "A".repeat(64) }, "email", "hashedEmail")).toEqual(["a".repeat(64)]);
    expect(() => metaHashes({ email: "a@example.com", hashedEmail: "a".repeat(64) }, "email", "hashedEmail")).toThrow(
      "Invalid Meta"
    );
    expect(() => fixture().batch({})).toThrow("Invalid Meta");
  });
  it("keeps removal identity stable when secondary match attributes/value/privacy change", () => {
    const f = fixture("audience", { valueBased: true });
    const a = projectMetaAudience(
      "upsert",
      f.batch({ email: "a@example.com", phone: "+14155552671", lookalikeValue: 10, dataProcessingOptions: ["LDU"] })
        .records[0].row
    )[0];
    const b = projectMetaAudience(
      "upsert",
      f.batch({ email: "a@example.com", phone: "+14155552672", lookalikeValue: 20 }).records[0].row
    )[0];
    expect(a.identity).toEqual(b.identity);
    expect(a.remove).toEqual(b.remove);
    expect(a.remove).toEqual({ identity: { EMAIL: hash("a@example.com") }, member: { EMAIL: hash("a@example.com") } });
    expect(a.upsert).not.toEqual(b.upsert);
    expect(normalizeMetaAudience({ email: "a@example.com" }, f.options, "remove")).toEqual(a.remove);
    expect(() => f.batch({ email: "a@example.com" })).toThrow();
  });
  it("supports demographic and page-scoped identifiers without requiring email/phone", () => {
    const f = fixture("audience", { pageId: "88" });
    expect(f.batch({ pageScopedUserId: "1234" }).records[0].row).toMatchObject({ member: { PAGEUID: "1234" } });
    expect(() => fixture().batch({ pageScopedUserId: "1234" })).toThrow();
    expect(
      f.batch({ firstName: "Alice", lastName: "Example", country: "US", postalCode: "12345" }).records[0].row
    ).toMatchObject({ member: { FN: hash("alice"), LN: hash("example") } });
  });
});

describe("Meta delivery and recovery", () => {
  it("uses bounded audience requests and gives one API-receipt outcome per operation", async () => {
    const f = fixture();
    const batch = f.batch();
    f.fetch.mockResolvedValueOnce(f.ack(batch));
    const writer = await f.adapter.stream.createWriter(f.ctx);
    const result = await writer.upsert(batch);
    expect(result.outcomes).toEqual([{ operationId: "op", status: "accepted" }]);
    const [url, request] = f.fetch.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v26.0/456/users");
    expect(url).not.toContain(credentials.accessToken);
    expect(request).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
    expect(JSON.parse(request.body)).toMatchObject({
      payload: { schema: ["EMAIL"], data: [[hash("alice@example.com")]] },
      session: { batch_seq: 1, last_batch_flag: true },
    });
    expect(f.log.mock.calls.flat().join(" ")).toContain("matching");
    await expect(writer.upsert({ ...batch, records: Array(1001).fill(batch.records[0]) })).rejects.toThrow(
      "batch size"
    );
    expect(await writer.finish()).toEqual({ delivery: "accepted" });
    await writer.abort("error");
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not discard a known conversion receipt when diagnostic logging fails", async () => {
    const f = fixture("conversions");
    f.log.mockRejectedValue(new Error("log unavailable"));
    f.fetch.mockResolvedValueOnce(response({ events_received: 1 }));
    expect((await (await f.adapter.stream.createWriter(f.ctx)).upsert(f.batch())).outcomes[0].status).toBe("accepted");
  });
  it("honors cancellation before HTTP submission", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    const writer = await f.adapter.stream.createWriter({ ...f.ctx, signal: controller.signal });
    await expect(writer.upsert(f.batch())).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("sends DELETE with only identity, and recovers lost receipts by the original session without replay", async () => {
    const f = fixture();
    const batch = f.batch();
    batch.records[0].row = f.adapter.project("remove", batch.records[0].row)[0].remove;
    f.fetch.mockResolvedValueOnce(f.ack(batch, "remove"));
    await (
      await f.adapter.stream.createWriter(f.ctx)
    ).remove!(batch);
    expect(f.fetch.mock.calls[0][1].method).toBe("DELETE");
    f.fetch.mockResolvedValueOnce(
      response({
        data: [{ session_id: String(metaSessionId(f.ctx, batch, "remove")), num_received: 1, num_invalid_entries: 0 }],
      })
    );
    const recovered = await f.adapter.recovery!({}).reconcileBatch!(batch, "remove", undefined, f.ctx);
    expect(recovered.outcomes[0].status).toBe("accepted");
    expect(f.fetch.mock.calls[1][1].method).toBe("GET");
    expect(f.fetch.mock.calls[1][0]).toContain("/456/sessions?session_id=");
    expect(metaSessionId(f.ctx, batch, "upsert")).not.toBe(metaSessionId(f.ctx, batch, "remove"));
    expect(metaSessionId({ ...f.ctx, logicalRunId: "other" }, batch, "remove")).not.toBe(
      metaSessionId(f.ctx, batch, "remove")
    );
  });
  it.each([
    { num_received: 0, num_invalid_entries: 0 },
    { num_received: 1, num_invalid_entries: 1 },
  ])("does not invent row outcomes for aggregate partial/invalid counts %j", async counts => {
    const f = fixture();
    const batch = f.batch();
    f.fetch.mockResolvedValueOnce(
      response({
        audience_id: "456",
        session_id: String(metaSessionId(f.ctx, batch, "upsert")),
        ...counts,
        invalid_entry_samples: { pii: "secret@example.com" },
      })
    );
    await expect((await f.adapter.stream.createWriter(f.ctx)).upsert(batch)).rejects.toThrow("manual reconciliation");
    expect(f.log.mock.calls.flat().join(" ")).not.toContain("secret@example.com");
    f.fetch.mockResolvedValueOnce(response({ data: [] }));
    try {
      await f.adapter.recovery!({}).reconcileBatch!(batch, "upsert", undefined, f.ctx);
      throw new Error("must reject");
    } catch (error) {
      expect(requiresManualReconciliation(error)).toBe(true);
    }
  });
  it.each([429, 500])("does not retry HTTP %s or leak provider errors", async status => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(
      response({ error: { code: 4, message: "secret-meta-token secret@example.com", is_transient: true } }, status)
    );
    await expect((await f.adapter.stream.createWriter(f.ctx)).upsert(f.batch())).rejects.toThrow(`HTTP ${status}`);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.log.mock.calls.flat().join(" ")).not.toMatch(/secret-meta-token|secret@example/);
  });
  it("retains uncertain transport errors and never replays conversions", async () => {
    const f = fixture("conversions");
    const batch = f.batch();
    f.fetch.mockRejectedValueOnce(new Error("socket failed with secret-meta-token"));
    await expect((await f.adapter.stream.createWriter(f.ctx)).upsert(batch)).rejects.toThrow("verifiable response");
    await expect(f.adapter.recovery!({}).reconcileBatch!(batch, "upsert", undefined, f.ctx)).rejects.toThrow(
      "manual reconciliation"
    );
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.log.mock.calls.flat().join(" ")).not.toContain(credentials.accessToken);
  });
  it("rejects known whole-request errors immediately with safe codes", async () => {
    const f = fixture("conversions");
    f.fetch.mockResolvedValueOnce(response({ error: { code: 100, error_subcode: 2804003, message: "raw PII" } }, 400));
    const result = await (await f.adapter.stream.createWriter(f.ctx)).upsert(f.batch());
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", code: "META_100" });
    expect(JSON.stringify(result)).not.toContain("raw PII");
  });
  it("checks saved receipt binding and runs the actual upsert lifecycle", async () => {
    const f = fixture("conversions");
    const batch = f.batch();
    f.fetch.mockImplementation(async () => response({ events_received: 1 }));
    const receipt = await (await f.adapter.stream.createWriter(f.ctx)).upsert(batch);
    expect(await f.adapter.recovery!({}).reconcileBatch!(batch, "upsert", receipt, f.ctx)).toEqual(receipt);
    await expect(
      f.adapter.recovery!({}).reconcileBatch!({ ...batch, batchId: "other" }, "upsert", receipt, f.ctx)
    ).rejects.toThrow("manual");
    const calls: string[] = [];
    f.ctx.delivery = {
      assertReady: async () => ({ sourceSequence: 0 }),
      ...Object.fromEntries(
        [
          "prepareInit",
          "acknowledgeInit",
          "prepare",
          "acknowledge",
          "prepareFinish",
          "acknowledgeFinish",
          "commitCheckpoint",
          "markUnknown",
          "prepareAbort",
          "acknowledgeAbort",
        ].map(name => [
          name,
          async () => {
            calls.push(name);
          },
        ])
      ),
    } as any;
    await runReverseEtl({
      stream: f.adapter.stream,
      context: f.ctx,
      mapping: { email: "email" },
      sourceKeyField: "__sourceKey",
      checkpointEvery: 100,
      source: async function* () {
        yield { key: contentHash("row"), row: { email: "a@example.com" }, deleted: false };
      },
    });
    expect(calls).toContain("acknowledgeFinish");
    expect(calls.indexOf("prepare")).toBeLessThan(calls.indexOf("acknowledge"));
  });
});

describe("Meta conversion mappings", () => {
  it.each([
    ["messenger", { pageId: "123", pageScopedUserId: "456" }, { page_id: "123", page_scoped_user_id: "456" }],
    [
      "whatsapp",
      { whatsappBusinessAccountId: "123", ctwaClid: "click-id" },
      { whatsapp_business_account_id: "123", ctwa_clid: "click-id" },
    ],
    [
      "instagram",
      { instagramAccountId: "123", instagramScopedId: "456" },
      { instagram_business_account_id: "123", ig_sid: "456" },
    ],
  ] as const)("maps %s messaging channel and its required identifiers", (channel, row, user) => {
    const f = fixture("conversions", { actionSource: "business_messaging", messagingChannel: channel });
    expect(f.batch(row).records[0].row.payload).toMatchObject({
      messaging_channel: channel,
      action_source: "business_messaging",
      user_data: user,
    });
    expect(() => f.batch({ email: "a@example.com" })).toThrow("Invalid Meta");
    expect(() => fixture("conversions", { actionSource: "business_messaging" }).batch(row)).toThrow("Invalid Meta");
    expect(
      fixture("conversions", { actionSource: "physical_store" }).batch({
        ...row,
        actionSource: "business_messaging",
        messagingChannel: channel,
      }).records[0].row.payload
    ).toMatchObject({ messaging_channel: channel });
  });
  it("maps optional identifiers/custom fields, hashes arrays and creates stable event IDs", () => {
    const f = fixture("conversions");
    const input = {
      email: ["Alice@EXAMPLE.COM", "bob@example.com"],
      phone: ["+14155552671"],
      value: "0",
      currency: "usd",
      eventName: "Purchase",
      eventTime: "2026-09-24T12:00:00Z",
      contents: '[{"id":"sku","quantity":1}]',
      customData: '{"coupon":"sale","value":99}',
      dataProcessingOptions: '["LDU"]',
      dataProcessingCountry: 1,
      dataProcessingState: 1000,
      externalId: "Customer-1",
    };
    const a = f.batch(input).records[0].row.payload as any;
    expect(a).toMatchObject({
      event_name: "Purchase",
      event_time: 1790251200,
      action_source: "physical_store",
      custom_data: { value: 0, currency: "USD", coupon: "sale" },
      data_processing_options: ["LDU"],
    });
    expect(a.user_data.em).toEqual([hash("alice@example.com"), hash("bob@example.com")].sort());
    expect(a.user_data.external_id).toEqual([hash("Customer-1")]);
    expect(f.batch(input).records[0].row.payload).toEqual(a);
    expect(f.adapter.insertOnly).toBe(true);
    expect(f.adapter.stream.capabilities.supportsExplicitRemove).toBe(false);
  });
  it("enforces conditional web/app requirements but not unnecessary contact fields", () => {
    const f = fixture("conversions", { actionSource: "website" });
    expect(() => f.batch({ email: "a@example.com" })).toThrow();
    expect(() =>
      f.batch({ fbp: "fb.1.123.456", clientUserAgent: "test", eventSourceUrl: "https://example.com" })
    ).not.toThrow();
    const app = fixture("conversions", { actionSource: "app" });
    expect(() => app.batch({ email: "a@example.com" })).toThrow();
    expect(() =>
      app.batch({
        email: "a@example.com",
        appData: {
          advertiser_tracking_enabled: 1,
          application_tracking_enabled: 0,
          extinfo: ["i2", ...Array(15).fill("")],
        },
      })
    ).not.toThrow();
    expect(() => fixture("conversions").batch({ email: "a@example.com", eventTime: "2026-09-24 12:00:00" })).toThrow();
  });
});
