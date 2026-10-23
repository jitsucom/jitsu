import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { JsonObject, ReverseEtlContext, WriteBatch } from "@jitsu/protocols/reverse-etl";
import type { DestinationServices, ReverseDestinationConfig } from "@jitsu/protocols/reverse-etl-runtime";
import { createOpenAiAdsRuntime } from "../src/functions/openai-ads/runtime";
import { normalizeOpenAiConversion } from "../src/functions/openai-ads/conversions";
import { digest, openAiNormalize } from "../src/functions/openai-ads/identifiers";
import {
  OpenAiAdsCredentials,
  OpenAiConversionOptions,
  validateOpenAiAdsReverseSettings,
} from "../src/functions/openai-ads/reverse-meta";
import { openAiConversionValidationErrors } from "../src/functions/openai-ads/validation-errors";
import { openAiConversionsUrl } from "../src/functions/openai-ads/client";
import { OpenAiUncertainDelivery } from "../src/functions/openai-ads/delivery";
import { openAiConversionEditor } from "../src/functions/openai-ads/editor";
import { reverseDestinationMetadata } from "../src/reverse-etl/catalog";
import { reverseDestinationRuntime } from "../src/reverse-etl/runtime";
import { createBufferedSyncStore } from "../src/reverse-etl/identity";
import { ensureNoRejection, validateBatchResult } from "../src/reverse-etl/meta";
import { requiresManualReconciliation, reverseEtlFailure } from "../src/reverse-etl/failure";
import { streamRequirementErrors } from "../src/reverse-etl/editor";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const key = (n: number) => sha(`row-${n}`);
const NOW = Date.parse("2026-10-21T12:00:00Z");
const settings = OpenAiConversionOptions.parse({ pixelId: "px_1", eventType: "order_created" });
const web = { sourceUrl: "https://shop.example.com/checkout" };
const normalize = (row: Record<string, unknown>, options = settings) =>
  normalizeOpenAiConversion({ __sourceKey: key(1), ...row }, options, "sync", NOW) as {
    key: string;
    payload: Record<string, any>;
  };
const failure = (
  row: Record<string, unknown>,
  reason: keyof typeof openAiConversionValidationErrors,
  options = settings
) =>
  expect(() => normalize(row, options)).toThrow(
    `Invalid OpenAI conversion: ${openAiConversionValidationErrors[reason]}`
  );

describe("OpenAI Ads identifier normalization (Conversions API rules)", () => {
  it("matches the examples published in OpenAI's docs", () => {
    expect(openAiNormalize("phone", "+1 (415) 555-2671")).toBe("14155552671");
    expect(openAiNormalize("firstName", "Mary Jane")).toBe("maryjane");
    expect(openAiNormalize("lastName", "O'Connor")).toBe("oconnor");
    expect(openAiNormalize("firstName", "José")).toBe("josé");
    // Digests printed in the documentation's own user-object example.
    expect(digest("14155552671")).toBe("758fbf68945f21c416814c539ab578876c8d98fb69e6da692def92cd52417fe0");
    expect(digest(openAiNormalize("email", "  User@Example.com "))).toBe(
      "b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514"
    );
  });
  it("keeps the external ID case, drops leading zeros and the plus from phones", () => {
    expect(openAiNormalize("externalId", "  Cust-ABC ")).toBe("Cust-ABC");
    expect(openAiNormalize("phone", "+0044 20 7946 0958".replace("+00", "+"))).toBe("442079460958");
    expect(openAiNormalize("phone", "00 14155552671")).toBe("14155552671");
  });
  it("rejects values that cannot be normalized instead of dropping them", () => {
    for (const phone of ["12345", "abc", "1".repeat(16), ""]) expect(() => openAiNormalize("phone", phone)).toThrow();
    expect(() => openAiNormalize("email", "not-an-email")).toThrow();
    expect(() => openAiNormalize("firstName", "!!!")).toThrow();
  });
});

describe("OpenAI conversion payload", () => {
  it("builds an order event and never carries raw customer data", () => {
    const { key: sourceKey, payload } = normalize({
      ...web,
      eventTime: "2026-10-21T11:59:00Z",
      amount: 4200,
      currency: "usd",
      contents: JSON.stringify([{ id: "sku1", quantity: 2, amount: 2100, currency: "usd" }]),
      email: "User@Example.com",
      phone: "+1 (415) 555-2671",
      firstName: "Mary Jane",
      country: "us",
      postalCode: "94107",
      ipAddress: "203.0.113.1",
    });
    expect(sourceKey).toBe(key(1));
    expect(payload).toMatchObject({
      type: "order_created",
      action_source: "web",
      source_url: "https://shop.example.com/checkout",
      timestamp_ms: Date.parse("2026-10-21T11:59:00Z"),
      data: {
        type: "contents",
        amount: 4200,
        currency: "USD",
        contents: [{ id: "sku1", quantity: 2, amount: 2100, currency: "USD" }],
      },
      user: {
        emails_sha256: [sha("user@example.com")],
        phone_numbers_sha256: [sha("14155552671")],
        first_names_sha256: [sha("maryjane")],
        countries: ["US"],
        postal_codes: ["94107"],
        ip_address: "203.0.113.1",
      },
    });
    const text = JSON.stringify(payload);
    for (const raw of ["User@Example.com", "user@example.com", "4155552671", "Mary Jane"])
      expect(text).not.toContain(raw);
  });
  it("derives data.type from the event type", () => {
    const types = {
      lead_created: "customer_action",
      page_viewed: "contents",
      trial_started: "plan_enrollment",
      subscription_created: "plan_enrollment",
    } as const;
    for (const [eventType, dataType] of Object.entries(types))
      expect(normalize({ ...web, eventType }).payload.data.type).toBe(dataType);
    expect(
      normalize({ eventType: "custom", customEventName: "Demo_Booked", actionSource: "offline" }).payload
    ).toMatchObject({
      type: "custom",
      custom_event_name: "demo_booked",
      data: { type: "custom" },
    });
  });
  it("uses a deterministic default event ID from the sync and the source key, and a mapped one when present", () => {
    const a = normalize(web).payload.id;
    expect(a).toMatch(/^jitsu-[a-f0-9]{64}$/);
    expect(normalize(web).payload.id).toBe(a);
    expect(
      normalizeOpenAiConversion({ __sourceKey: key(1), ...web }, settings, "another-sync", NOW).payload
    ).not.toMatchObject({ id: a });
    expect(normalize({ ...web, eventId: "order_1" }).payload.id).toBe("order_1");
  });
  it("passes oppref through unchanged and sets opt_out only when given", () => {
    const withRef = normalize({ ...web, oppref: " Opaque/Ref= ", optOut: false }).payload;
    expect(withRef.oppref).toBe(" Opaque/Ref= ");
    expect(withRef.opt_out).toBe(false);
    expect(normalize(web).payload).not.toHaveProperty("opt_out");
  });
  it("sends only pre-hashed values lowercased, never hashing them again", () => {
    const upper = sha("someone@example.com").toUpperCase();
    expect(normalize({ ...web, hashedEmail: upper }).payload.user.emails_sha256).toEqual([sha("someone@example.com")]);
  });
  it("accepts up to three distinct values per identifier and no more", () => {
    const emails = ["a@x.com", "b@x.com", "c@x.com"];
    expect(normalize({ ...web, email: emails }).payload.user.emails_sha256).toHaveLength(3);
    failure({ ...web, email: [...emails, "d@x.com"] }, "userList");
    expect(normalize({ ...web, email: ["a@x.com", "A@X.com"] }).payload.user.emails_sha256).toHaveLength(1);
  });
  it("fails the row for an invalid identifier or for both raw and hashed columns", () => {
    failure({ ...web, phone: "12" }, "identifier");
    failure({ ...web, email: "a@x.com", hashedEmail: sha("a@x.com") }, "identifier");
    failure({ ...web, hashedEmail: "abc" }, "identifier");
    failure({ ...web, hashedPhone: ["z".repeat(64)] }, "identifier");
  });
});

describe("OpenAI conversion validation", () => {
  it("accepts ISO timestamps and Unix milliseconds, and defaults to the extraction time", () => {
    expect(normalize({ ...web, eventTime: NOW - 1000 }).payload.timestamp_ms).toBe(NOW - 1000);
    expect(normalize({ ...web, eventTime: String(NOW - 1000) }).payload.timestamp_ms).toBe(NOW - 1000);
    expect(normalize(web).payload.timestamp_ms).toBe(NOW);
  });
  it("enforces the 7-day and 10-minute window and refuses seconds instead of guessing the unit", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(normalize({ ...web, eventTime: NOW - 7 * day + 1000 }).payload.timestamp_ms).toBe(NOW - 7 * day + 1000);
    failure({ ...web, eventTime: NOW - 7 * day - 1000 }, "eventTime");
    expect(normalize({ ...web, eventTime: NOW + 9 * 60 * 1000 }).payload.timestamp_ms).toBe(NOW + 9 * 60 * 1000);
    failure({ ...web, eventTime: NOW + 11 * 60 * 1000 }, "eventTime");
    failure({ ...web, eventTime: Math.floor(NOW / 1000) }, "eventTime");
    failure({ ...web, eventTime: "2026-10-21 11:00:00" }, "eventTime");
    failure({ ...web, eventTime: "yesterday" }, "eventTime");
  });
  it("requires an event type, a web source URL and mobile_app for app events", () => {
    failure(web, "eventType", OpenAiConversionOptions.parse({ pixelId: "px_1" }));
    failure({}, "sourceUrl");
    failure({ sourceUrl: "not a url" }, "sourceUrl");
    failure({ sourceUrl: "shop.example.com/checkout" }, "sourceUrl");
    failure({ actionSource: "offline", sourceUrl: "nonsense" }, "sourceUrl");
  });
  it("applies the app event rule and accepts a non-web source without a URL", () => {
    failure({ eventType: "app_installed", actionSource: "web", ...web }, "actionSource");
    expect(normalize({ eventType: "app_opened", actionSource: "mobile_app" }).payload.action_source).toBe("mobile_app");
    expect(normalize({ actionSource: "offline" }).payload).not.toHaveProperty("source_url");
  });
  it("validates custom event names", () => {
    const custom = OpenAiConversionOptions.parse({ pixelId: "px_1", eventType: "custom", actionSource: "offline" });
    failure({}, "customEventName", custom);
    failure({ customEventName: "order_created" }, "customEventName", custom);
    failure({ customEventName: "_bad" }, "customEventName", custom);
    failure({ customEventName: "x".repeat(65) }, "customEventName", custom);
    expect(normalize({ customEventName: "A-1" }, custom).payload.custom_event_name).toBe("a-1");
    const withDefault = OpenAiConversionOptions.parse({ ...custom, customEventName: "Signed_Up" });
    expect(normalize({}, withDefault).payload.custom_event_name).toBe("signed_up");
  });
  it("requires a currency with an amount, whole minor units, and the right data shape", () => {
    failure({ ...web, amount: 100 }, "amount");
    expect(() => normalize({ ...web, amount: 10.5, currency: "USD" })).toThrow();
    expect(() => normalize({ ...web, amount: 100, currency: "USDX" })).toThrow();
    expect(normalize({ ...web, amount: "1999", currency: "eur" }).payload.data).toMatchObject({
      amount: 1999,
      currency: "EUR",
    });
    failure({ ...web, eventType: "lead_created", contents: [{ id: "x" }] }, "contents");
    failure({ ...web, planId: "pro" }, "planId");
    expect(normalize({ ...web, eventType: "trial_started", planId: "pro" }).payload.data).toMatchObject({
      type: "plan_enrollment",
      plan_id: "pro",
    });
  });
  it("keeps the event currency when only the items carry amounts", () => {
    const data = normalize({ ...web, currency: "usd", contents: [{ id: "x", quantity: 1, amount: 1999 }] }).payload
      .data as Record<string, unknown>;
    expect(data).toMatchObject({ currency: "USD", contents: [{ id: "x", quantity: 1, amount: 1999 }] });
    expect(data).not.toHaveProperty("amount");
    // A currency with nothing to price stays out of the payload.
    expect(normalize({ ...web, currency: "usd" }).payload.data).not.toHaveProperty("currency");
  });
  it("accepts integer strings in item quantity and amount, as warehouse readers return them", () => {
    const contents = normalize({ ...web, currency: "usd", contents: [{ id: "x", quantity: "2", amount: "1999" }] })
      .payload.data as { contents: unknown };
    expect(contents.contents).toEqual([{ id: "x", quantity: 2, amount: 1999 }]);
    expect(() => normalize({ ...web, currency: "usd", contents: [{ quantity: "1.5" }] })).toThrow();
    expect(() => normalize({ ...web, currency: "usd", contents: [{ amount: "12abc" }] })).toThrow();
  });
  it("rejects invalid locations and unknown content fields", () => {
    failure({ ...web, country: "USA" }, "location");
    failure({ ...web, postalCode: "9410#" }, "location");
    expect(() => normalize({ ...web, contents: [{ id: "x", surprise: 1 }] })).toThrow();
  });
  it("requires the source key the runner adds", () => {
    expect(() => normalizeOpenAiConversion({ ...web }, settings, "sync", NOW)).toThrow();
  });
});

describe("OpenAI Ads settings", () => {
  const options = (patch: Record<string, unknown> = {}, mapping: Record<string, string> = { sourceUrl: "url" }) => ({
    stream: "conversions",
    mode: "upsert" as const,
    mapping,
    streamOptions: { pixelId: "px_1", eventType: "order_created", actionSource: "web", ...patch },
  });
  const ok = { conversionsApiKey: "key-123" };
  it("accepts a complete configuration", () => {
    expect(() => validateOpenAiAdsReverseSettings(options(), {}, ok)).not.toThrow();
    expect(() =>
      validateOpenAiAdsReverseSettings(options({}, { eventType: "t", sourceUrl: "u" }), {}, ok)
    ).not.toThrow();
  });
  it("rejects what cannot work before any run", () => {
    expect(() => validateOpenAiAdsReverseSettings(options(), {}, {})).toThrow("Conversions API key");
    expect(() => validateOpenAiAdsReverseSettings({ ...options(), stream: "audience" }, {}, ok)).toThrow("Unsupported");
    expect(() => validateOpenAiAdsReverseSettings({ ...options(), mode: "mirror" }, {}, ok)).toThrow("insert mode");
    expect(() => validateOpenAiAdsReverseSettings(options(), { deleteColumn: "d" }, ok)).toThrow("delete column");
    expect(() => validateOpenAiAdsReverseSettings(options({ pixelId: "" }), {}, ok)).toThrow("Pixel ID");
    expect(() => validateOpenAiAdsReverseSettings(options({ eventType: undefined }), {}, ok)).toThrow("event type");
    expect(() => validateOpenAiAdsReverseSettings(options({ eventType: "custom" }), {}, ok)).toThrow(
      "custom event name"
    );
    expect(() => validateOpenAiAdsReverseSettings(options({}, {}), {}, ok)).toThrow("source URL");
    expect(() =>
      validateOpenAiAdsReverseSettings(
        options({ eventType: "app_opened", actionSource: "web" }, { sourceUrl: "u" }),
        {},
        ok
      )
    ).toThrow("mobile_app");
    expect(() => validateOpenAiAdsReverseSettings(options({}, { sourceUrl: "u", bogus: "x" }), {}, ok)).toThrow(
      "Unknown"
    );
    expect(() =>
      validateOpenAiAdsReverseSettings(options({}, { sourceUrl: "u", email: "e", hashedEmail: "h" }), {}, ok)
    ).toThrow("raw or SHA-256");
    expect(() => validateOpenAiAdsReverseSettings(options({}, { sourceUrl: "u", __sourceKey: "k" }), {}, ok)).toThrow(
      "Unknown"
    );
  });
  it("validates credentials", () => {
    expect(OpenAiAdsCredentials.safeParse({ conversionsApiKey: "  sk-abc  " }).data).toEqual({
      conversionsApiKey: "sk-abc",
    });
    expect(OpenAiAdsCredentials.safeParse({ conversionsApiKey: "has space" }).success).toBe(false);
    expect(OpenAiAdsCredentials.safeParse({}).success).toBe(false);
  });
  it("is registered in the browser catalog and the runner registry, and the editor lists missing settings", () => {
    expect(reverseDestinationMetadata.get("openai-ads")?.streams.map(s => s.id)).toEqual(["conversions"]);
    expect(reverseDestinationRuntime.has("openai-ads")).toBe(true);
    const errors = streamRequirementErrors(openAiConversionEditor, openAiConversionEditor.defaults());
    expect(errors).toEqual(expect.arrayContaining(["Pixel ID is required.", "Source URL is required."]));
    expect(errors.some(e => e.startsWith("Event type"))).toBe(true);
    const complete = {
      ...openAiConversionEditor.defaults(),
      mapping: { sourceUrl: "url" },
      streamOptions: { pixelId: "px_1", eventType: "order_created", actionSource: "web" },
    };
    expect(streamRequirementErrors(openAiConversionEditor, complete)).toEqual([]);
  });
  it("treats the event type as one alternative: a default setting or a mapped column", () => {
    const base = { ...openAiConversionEditor.defaults(), mapping: { sourceUrl: "url" } };
    const withDefault = { ...base, streamOptions: { pixelId: "px_1", eventType: "lead_created", actionSource: "web" } };
    const withColumn = { ...base, mapping: { ...base.mapping, eventType: "kind" }, streamOptions: { pixelId: "px_1" } };
    const neither = { ...base, streamOptions: { pixelId: "px_1", actionSource: "web" } };
    expect(streamRequirementErrors(openAiConversionEditor, withDefault)).toEqual([]);
    expect(streamRequirementErrors(openAiConversionEditor, withColumn)).toEqual([]);
    expect(streamRequirementErrors(openAiConversionEditor, neither).some(e => e.startsWith("Event type"))).toBe(true);
  });
  it("requires Source URL only when every row is a web event", () => {
    const options = (mapping: Record<string, string>, actionSource?: string) => ({
      ...openAiConversionEditor.defaults(),
      mapping,
      streamOptions: { pixelId: "px_1", eventType: "lead_created", ...(actionSource ? { actionSource } : {}) },
    });
    const missing = (o: ReturnType<typeof options>) =>
      streamRequirementErrors(openAiConversionEditor, o).some(e => e.startsWith("Source URL"));
    expect(missing(options({}, "web"))).toBe(true);
    expect(missing(options({}, "app"))).toBe(false);
    // A mapped action source leaves the per-row web check to runtime row validation.
    expect(missing(options({ actionSource: "channel" }, "web"))).toBe(false);
  });
  it("keeps server code out of the browser metadata", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of ["reverse-meta.ts", "editor.ts"]) {
      const source = await readFile(new URL(`../src/functions/openai-ads/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/from "(node:|\.\/client|\.\/delivery|\.\/conversions|\.\/runtime|\.\/identifiers)/);
    }
  });
});

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function fixture(fetchImpl: (url: string, init: any) => Promise<Response>) {
  const fetch = vi.fn(fetchImpl);
  const log = vi.fn(async () => {});
  const config: ReverseDestinationConfig & { options: { mapping: Record<string, string> } } = {
    id: "sync",
    workspaceId: "ws",
    toId: "dst",
    destination: { destinationType: "openai-ads", conversionsApiKey: "key-secret-123" },
    model: { primaryKey: ["id"] },
    options: {
      stream: "conversions",
      mode: "upsert",
      mapping: { sourceUrl: "url", email: "email" },
      streamOptions: { pixelId: "px_1", eventType: "order_created", actionSource: "web" },
    },
  };
  const services = {
    fetch,
    signal: new AbortController().signal,
    log,
    getAccessToken: async () => "",
  } as unknown as DestinationServices;
  const context = async () => {
    const adapter = await createOpenAiAdsRuntime(config, services);
    const ctx = {
      mode: "upsert",
      fullRefresh: false,
      syncId: "sync",
      taskId: "task",
      logicalRunId: "run",
      configRevision: "rev",
      targetIdentity: adapter.targetIdentity,
      credentials: adapter.credentials,
      options: adapter.options,
      signal: new AbortController().signal,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      fetch,
      store: createBufferedSyncStore(),
      delivery: {},
    } as unknown as ReverseEtlContext<JsonObject, JsonObject>;
    return { adapter, ctx, writer: await adapter.stream.createWriter(ctx) };
  };
  return { fetch, log, context };
}
function batch(adapter: { stream: { rowType: { parse(v: unknown): unknown } } }, count = 2): WriteBatch<JsonObject> {
  return {
    batchId: "batch-1",
    records: Array.from({ length: count }, (_, i) => ({
      key: key(i),
      sourceSequence: i + 1,
      operationId: `op-${i}`,
      row: adapter.stream.rowType.parse({
        __sourceKey: key(i),
        sourceUrl: "https://shop.example.com/checkout",
        email: `user${i}@example.com`,
        eventTime: Date.now() - 1000,
      }) as JsonObject,
    })),
  };
}

describe("OpenAI conversions delivery", () => {
  it("posts one batch with the pixel, bearer key and partner source, and reports it accepted", async () => {
    const { fetch, context, log } = fixture(async () => response({}));
    const { adapter, writer } = await context();
    const result = await writer.upsert(batch(adapter));
    const [url, init] = fetch.mock.calls[0] as [string, any];
    expect(url).toBe(`${openAiConversionsUrl}?pid=px_1`);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init.headers).toMatchObject({ Authorization: "Bearer key-secret-123", "Content-Type": "application/json" });
    const body = JSON.parse(init.body);
    expect(body.integration_source).toBe("jitsu");
    expect(body.events).toHaveLength(2);
    expect(init.body).not.toContain("key-secret-123");
    expect(init.body).not.toContain("user0@example.com");
    expect(result.outcomes.map(o => o.status)).toEqual(["accepted", "accepted"]);
    expect(result.submitted).toBe(true);
    expect(validateBatchResult(batch(adapter), result).outcomes).toHaveLength(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain("key-secret-123");
    expect(await writer.finish()).toEqual({ delivery: "accepted" });
  });
  // Response bodies below were recorded from OpenAI's Conversions API with validate_only requests on 22 Oct 2026.
  it.each([
    [
      "invalid event type",
      400,
      {
        error: {
          message: "Invalid event at events[0]. See errors for details.",
          type: "invalid_request_error",
          param: "events[0]",
          code: "invalid_event",
          errors: [
            {
              message: "events[0].type must be a supported event type.",
              param: "events[0].type",
              code: "unknown_event_type",
            },
          ],
        },
      },
      "OPENAI_INVALID_EVENT",
      [{ reason: "UNKNOWN_EVENT_TYPE", field: "events[0].type" }],
    ],
    [
      "stale timestamp",
      422,
      {
        error: {
          message: "event_timestamp_ms must be within the last 7 days.",
          type: "invalid_request_error",
          param: "events[0].timestamp_ms",
          code: "event_timestamp_too_old",
          errors: [
            {
              message: "event_timestamp_ms must be within the last 7 days.",
              param: "events[0].timestamp_ms",
              code: "event_timestamp_too_old",
            },
          ],
        },
      },
      "OPENAI_EVENT_TIMESTAMP_TOO_OLD",
      [{ reason: "EVENT_TIMESTAMP_TOO_OLD", field: "events[0].timestamp_ms" }],
    ],
    [
      "unknown pixel",
      403,
      { error: { message: "403: unknown pid", type: "server_error", param: null, code: null } },
      "http_403",
      undefined,
    ],
    [
      "bad key",
      401,
      { error: { message: "Unauthorized", type: "invalid_request_error", param: null, code: null } },
      "http_401",
      undefined,
    ],
  ])("maps OpenAI's recorded %s response to a definite rejection", async (_name, status, body, code, details) => {
    const { context } = fixture(async () => response(body, status));
    const { adapter, writer } = await context();
    const result = await writer.upsert(batch(adapter));
    const first = result.outcomes[0] as any;
    expect(result.outcomes.every(o => o.status === "rejected" && (o as any).code === code)).toBe(true);
    expect(first.details).toEqual(details);
    expect(result.submitted).toBe(true);
    expect(JSON.stringify(result)).not.toContain("unknown pid");
    expect(JSON.stringify(result)).not.toContain("must be");
  });
  it("still treats a refusal as definite when OpenAI's per-event error list is malformed", async () => {
    const { context } = fixture(async () =>
      response(
        {
          error: {
            message: "x",
            type: "invalid_request_error",
            param: "events[0]",
            code: "invalid_event",
            errors: "nope",
          },
        },
        400
      )
    );
    const { adapter, writer } = await context();
    const result = await writer.upsert(batch(adapter));
    expect(result.outcomes.every(o => o.status === "rejected")).toBe(true);
  });
  it("accepts OpenAI's recorded success body", async () => {
    const { context } = fixture(async () => response({ accepted_events: 2 }));
    const { adapter, writer } = await context();
    const result = await writer.upsert(batch(adapter));
    expect(result.outcomes.map(o => o.status)).toEqual(["accepted", "accepted"]);
  });
  it("rejects the whole batch when OpenAI refuses it, with a code the core may show", async () => {
    const { context } = fixture(async () =>
      response(
        {
          error: {
            message: "secret detail user0@example.com",
            type: "invalid_request_error",
            param: "events.0.type",
            code: "invalid_value",
          },
        },
        400
      )
    );
    const { adapter, writer } = await context();
    const result = await writer.upsert(batch(adapter));
    expect(result.outcomes.every(o => o.status === "rejected")).toBe(true);
    expect(result.submitted).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret detail");
    expect(JSON.stringify(result)).not.toContain("user0@example.com");
    expect(() => validateBatchResult(batch(adapter), result)).not.toThrow();
    const rejected = result.outcomes[0] as any;
    expect(rejected.code).toBe("OPENAI_INVALID_VALUE");
    expect(() => ensureNoRejection(result.outcomes)).toThrow("Destination rejected a row");
    try {
      ensureNoRejection(result.outcomes);
    } catch (error: any) {
      expect(error.code).toBe("OPENAI_INVALID_VALUE");
    }
  });
  it("falls back to an http_<status> code when OpenAI gives no usable error code", async () => {
    const { context } = fixture(async () =>
      response({ error: { message: "x", type: "invalid_request_error", param: null, code: null } }, 401)
    );
    const { adapter, writer } = await context();
    expect(((await writer.upsert(batch(adapter))).outcomes[0] as any).code).toBe("http_401");
  });
  it("treats rate limits, server errors, network failures and unreadable errors as unproven delivery", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => response({ error: { message: "slow down", type: "rate_limit", code: null, param: null } }, 429),
      async () => response({ error: { message: "oops", type: "server_error", code: null, param: null } }, 500),
      async () => new Response("<html>bad gateway</html>", { status: 400 }),
      async () => {
        throw new Error("socket hang up with secret details");
      },
    ];
    for (const impl of cases) {
      const { context } = fixture(impl);
      const { adapter, writer } = await context();
      const error = await writer.upsert(batch(adapter)).then(
        () => undefined,
        e => e
      );
      expect(error).toBeInstanceOf(OpenAiUncertainDelivery);
      expect(requiresManualReconciliation(error)).toBe(true);
      expect(error.message).not.toContain("secret");
    }
  });
  it("sends each batch once with no automatic retry", async () => {
    const { fetch, context } = fixture(async () =>
      response({ error: { message: "x", type: "server_error", code: null, param: null } }, 503)
    );
    const { adapter, writer } = await context();
    await writer.upsert(batch(adapter)).catch(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refuses empty and oversized batches, and non-insert modes", async () => {
    const { context } = fixture(async () => response({}));
    const { adapter, writer, ctx } = await context();
    await expect(writer.upsert({ batchId: "b", records: [] })).rejects.toThrow("batch size");
    await expect(writer.upsert(batch(adapter, 1001))).rejects.toThrow("batch size");
    await expect(adapter.stream.createWriter({ ...ctx, mode: "mirror" })).rejects.toThrow("insert-only");
  });
  it("refuses a writer bound to different settings or credentials", async () => {
    const { context } = fixture(async () => response({}));
    const { adapter, ctx } = await context();
    await expect(adapter.stream.createWriter({ ...ctx, targetIdentity: "openai-conversions:other" })).rejects.toThrow(
      "binding"
    );
    await expect(adapter.stream.createWriter({ ...ctx, credentials: { conversionsApiKey: "other" } })).rejects.toThrow(
      "binding"
    );
  });
  it("declares an insert-only stream that needs reconciliation after an unproven delivery", async () => {
    const { context } = fixture(async () => response({}));
    const { adapter } = await context();
    expect(adapter.insertOnly).toBe(true);
    expect(adapter.targetIdentity).toBe("openai-conversions:px_1");
    expect(adapter.stream).toMatchObject({
      name: "conversions",
      batchSize: 1000,
      capabilities: {
        supportsUpsert: true,
        supportsExplicitRemove: false,
        mirror: "none",
        replay: "reconcile-required",
      },
    });
    expect(adapter.project("upsert", { key: key(1), payload: { id: "x" } })).toEqual([
      { identity: { eventKey: key(1) }, upsert: { key: key(1), payload: { id: "x" } }, remove: {} },
    ]);
  });
  it("recovers a saved receipt for the same batch and never resubmits otherwise", async () => {
    const { fetch, context } = fixture(async () => response({}));
    const { adapter, ctx, writer } = await context();
    const recovery = adapter.recovery!({});
    const sent = batch(adapter);
    const saved = await writer.upsert(sent);
    fetch.mockClear();
    expect(await recovery.reconcileBatch!(sent, "upsert", saved, ctx)).toEqual(saved);
    await expect(recovery.reconcileBatch!(sent, "upsert", undefined, ctx)).rejects.toBeInstanceOf(
      OpenAiUncertainDelivery
    );
    await expect(recovery.reconcileBatch!({ ...sent, batchId: "other" }, "upsert", saved, ctx)).rejects.toBeInstanceOf(
      OpenAiUncertainDelivery
    );
    await expect(recovery.reconcileBatch!(sent, "remove", saved, ctx)).rejects.toBeInstanceOf(OpenAiUncertainDelivery);
    const staged = { ...saved, outcomes: saved.outcomes.map(o => ({ ...o, status: "staged" as const })) };
    await expect(recovery.reconcileBatch!(sent, "upsert", staged as any, ctx)).rejects.toBeInstanceOf(
      OpenAiUncertainDelivery
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(await recovery.reconcileInit!(ctx)).toBe("absent");
    expect(await recovery.reconcileFinish!(undefined, ctx)).toEqual({ delivery: "accepted" });
  });
});

describe("OpenAI Ads failure messages", () => {
  it("shows an explanation for every validation reason and for unproven delivery, without row values", () => {
    for (const detail of Object.values(openAiConversionValidationErrors)) {
      const found = reverseEtlFailure(new Error(`Invalid OpenAI conversion: ${detail}`));
      expect(found?.message).toContain(detail);
      expect(found?.message).toContain("This row was not submitted");
    }
    expect(reverseEtlFailure(new OpenAiUncertainDelivery())?.message).toContain("OpenAI did not confirm delivery");
  });
});
