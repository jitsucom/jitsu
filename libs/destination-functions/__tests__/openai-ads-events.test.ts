import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { RetryError } from "@jitsu/functions-lib";
import OpenAiAdsDestination, {
  openAiDefaultEventMap,
  parseOpenAiEventMappings,
  toOpenAiEvent,
} from "../src/functions/openai-ads/events";
import {
  OpenAiAdsCredentials,
  OpenAiAdsDestinationCredentials,
  openAiEventDataTypes,
} from "../src/functions/openai-ads/reverse-meta";
import { openAiConversionsUrl } from "../src/functions/openai-ads/client";
import { getBuiltinFunction } from "../src";

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const KEY = "fake-conversions-key";
const NOW = Date.parse("2026-11-02T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const props = (extra: Record<string, unknown> = {}) =>
  OpenAiAdsDestinationCredentials.parse({ conversionsApiKey: KEY, pixelId: "px_test", ...extra });

function event(overrides: Record<string, any> = {}): any {
  const { context, properties, ...rest } = overrides;
  return {
    type: "track",
    event: "Order Completed",
    messageId: "msg-1",
    userId: "user-1",
    anonymousId: "anon-1",
    timestamp: iso(NOW - 60_000),
    receivedAt: iso(NOW - 59_000),
    properties: { currency: "USD", total: 42.5, ...properties },
    context: {
      page: { url: "https://shop.example.com/thanks" },
      traits: { email: "Dave@Example.com" },
      ip: "203.0.113.9",
      userAgent: "UA/1",
      ...context,
    },
    ...rest,
  };
}
const built = (e: any, p = props()) => {
  const r = toOpenAiEvent(e, p, NOW);
  if ("skip" in r) throw new Error(`skipped: ${r.skip}`);
  return r.event as any;
};
const skipped = (e: any, p = props()) => {
  const r = toOpenAiEvent(e, p, NOW);
  if (!("skip" in r)) throw new Error("expected a skip");
  return r.skip;
};

describe("event names", () => {
  it("maps every built-in table row to a standard OpenAI event", () => {
    for (const [name, type] of Object.entries(openAiDefaultEventMap)) {
      const e = name === "page" ? event({ type: "page", event: undefined }) : event({ event: name });
      expect(built(e).type).toBe(type);
      expect(Object.hasOwn(openAiEventDataTypes, type)).toBe(true);
    }
  });
  it("sends a standard OpenAI name as itself and anything else as a custom event", () => {
    expect(built(event({ event: "trial_started" })).type).toBe("trial_started");
    const custom = built(event({ event: "Button Clicked" }));
    expect(custom.type).toBe("custom");
    expect(custom.custom_event_name).toBe("button_clicked");
    expect(custom.data.type).toBe("custom");
  });
  it("lets a user line win over the table, and ignores lines that are not name=standard-event", () => {
    const p = props({
      eventMappings: ["Order Completed=lead_created", "Broken line", "x=not_an_event", "=order_created"],
    });
    expect(built(event(), p).type).toBe("lead_created");
    const { mappings, invalid } = parseOpenAiEventMappings(p.eventMappings);
    expect([...mappings.keys()]).toEqual(["Order Completed"]);
    expect(invalid).toEqual(["Broken line", "x=not_an_event", "=order_created"]);
  });
  it("turns arbitrary names into valid custom names of at most 64 characters", () => {
    const long = built(event({ event: `A very long event name, with: punctuation! ${"x".repeat(80)}` }));
    expect(long.custom_event_name).toMatch(/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/);
    expect(long.custom_event_name.length).toBeLessThanOrEqual(64);
    expect(skipped(event({ event: "!!!" }))).toContain("custom event name");
  });
  it("skips an event whose only possible custom name is one of OpenAI's own names", () => {
    expect(skipped(event({ event: "custom" }))).toContain("custom event name");
    expect(skipped(event({ event: "CUSTOM" }))).toContain("custom event name");
  });
});

describe("payload fields", () => {
  it("uses the message id for deduplication and the event time in milliseconds", () => {
    const e = built(event());
    expect(e.id).toBe("msg-1");
    expect(e.timestamp_ms).toBe(NOW - 60_000);
    expect(e.action_source).toBe("web");
    expect(e.source_url).toBe("https://shop.example.com/thanks");
  });
  it("converts totals to minor units by the currency's own exponent", () => {
    expect(built(event()).data).toMatchObject({ type: "contents", amount: 4250, currency: "USD" });
    expect(built(event({ properties: { currency: "jpy", total: 43 } })).data).toMatchObject({
      amount: 43,
      currency: "JPY",
    });
    expect(built(event({ properties: { currency: "KWD", total: 1.234 } })).data.amount).toBe(1234);
  });
  it("sends no amount without a usable currency or value, and prefers total, then value, then revenue", () => {
    expect(built(event({ properties: { currency: undefined } })).data.amount).toBeUndefined();
    expect(built(event({ properties: { total: undefined, value: undefined, revenue: 5 } })).data.amount).toBe(500);
    expect(built(event({ properties: { total: undefined, value: 7, revenue: 5 } })).data.amount).toBe(700);
    expect(built(event({ properties: { total: -1 } })).data.amount).toBeUndefined();
    expect(built(event({ properties: { total: "abc" } })).data.amount).toBeUndefined();
  });
  it("maps products to contents with minor-unit prices, and omits them for customer_action events", () => {
    const products = [
      { product_id: "sku-1", name: "Shoe", price: 20, quantity: 2 },
      { sku: "sku-2", price: 2.5, quantity: "3" },
      null,
    ];
    expect(built(event({ properties: { products } })).data.contents).toEqual([
      { id: "sku-1", name: "Shoe", quantity: 2, amount: 2000, currency: "USD" },
      { id: "sku-2", quantity: 3, amount: 250, currency: "USD" },
    ]);
    expect(built(event({ event: "Signed Up", properties: { products } })).data.contents).toBeUndefined();
    expect(built(event({ properties: { products: undefined, product_id: "p9", quantity: 1 } })).data.contents).toEqual([
      { id: "p9", quantity: 1 },
    ]);
  });
  it("sends a plan id only for plan and custom events", () => {
    expect(built(event({ event: "trial_started", properties: { plan_id: "pro" } })).data.plan_id).toBe("pro");
    expect(built(event({ event: "Order Completed", properties: { plan_id: "pro" } })).data.plan_id).toBeUndefined();
  });
  it("merges event.openaiAdsEvent over the built payload", () => {
    const e = built(event({ openaiAdsEvent: { data: { amount: 1 }, opt_out: true } }));
    expect(e.data.amount).toBe(1);
    expect(e.opt_out).toBe(true);
    expect(e.type).toBe("order_created");
  });
});

describe("customer identifiers", () => {
  it("hashes a normalized email and the user and anonymous ids, never sending raw values", () => {
    const { user } = built(event());
    expect(user.emails_sha256).toEqual([sha("dave@example.com")]);
    expect(user.external_ids_sha256).toEqual([sha("user-1"), sha("anon-1")].sort());
    expect(JSON.stringify(user)).not.toContain("Dave@Example.com");
    expect(user.ip_address).toBe("203.0.113.9");
    expect(user.user_agent).toBe("UA/1");
  });
  it("sends the phone only when a trait name is configured, normalized like the Reverse ETL path", () => {
    const e = event({ context: { traits: { email: "a@b.co", mobile: "+1 (415) 555-0100" } } });
    expect(built(e).user.phone_numbers_sha256).toBeUndefined();
    expect(built(e, props({ phoneFieldName: "mobile" })).user.phone_numbers_sha256).toEqual([sha("14155550100")]);
  });
  it("drops an identifier OpenAI would refuse, not the event", () => {
    const e = built(event({ context: { traits: { email: "not-an-email" }, ip: "999.1.1.1" } }));
    expect(e.user.emails_sha256).toBeUndefined();
    expect(e.user.ip_address).toBeUndefined();
    expect(e.user.external_ids_sha256).toHaveLength(2);
  });
  it("takes the first address of a forwarded list and drops an empty user object", () => {
    expect(built(event({ context: { ip: "198.51.100.7, 10.0.0.1" } })).user.ip_address).toBe("198.51.100.7");
    const bare = built(
      event({ userId: undefined, anonymousId: undefined, context: { traits: {}, ip: undefined, userAgent: undefined } })
    );
    expect(bare.user).toBeUndefined();
  });
});

describe("click reference", () => {
  it("reads oppref from the SDK client ids first, then the page URL, then the search string", () => {
    expect(built(event({ context: { clientIds: { oppref: "FROM-IDS" } } })).oppref).toBe("FROM-IDS");
    const url = "https://shop.example.com/a?x=1&oppref=FROM-URL#frag";
    expect(built(event({ context: { page: { url } } })).oppref).toBe("FROM-URL");
    expect(
      built(event({ context: { page: { url: "https://shop.example.com/a", search: "?oppref=FROM-SEARCH" } } })).oppref
    ).toBe("FROM-SEARCH");
    expect(built(event()).oppref).toBeUndefined();
  });
  it("passes the value through unchanged, and forwards obref when the SDK captured it", () => {
    const e = built(event({ context: { clientIds: { oppref: " Opaque/Ref= ", obref: "br-1" } } }));
    expect(e.oppref).toBe(" Opaque/Ref= ");
    expect(e.user.obref).toBe("br-1");
  });
});

describe("action source and skips", () => {
  it("skips a web event without a usable page URL, but not a server event on another source", () => {
    expect(skipped(event({ context: { page: undefined } }))).toContain("page URL");
    expect(skipped(event({ context: { page: { url: "/relative" } } }))).toContain("page URL");
    const server = built(event({ context: { page: undefined } }), props({ actionSource: "other" }));
    expect(server.action_source).toBe("other");
    expect(server.source_url).toBeUndefined();
  });
  it("forces mobile_app for the two app events", () => {
    const e = built(event({ event: "app_installed", context: { page: undefined } }));
    expect(e.action_source).toBe("mobile_app");
  });
  it("skips events outside OpenAI's seven-day window and events without a name or message id", () => {
    expect(skipped(event({ timestamp: iso(NOW - 8 * 86_400_000), receivedAt: iso(NOW - 8 * 86_400_000) }))).toContain(
      "event time"
    );
    expect(built(event({ timestamp: iso(NOW - 6 * 86_400_000), receivedAt: iso(NOW - 6 * 86_400_000) })).id).toBe(
      "msg-1"
    );
    expect(skipped(event({ event: undefined }))).toContain("no name");
    expect(skipped(event({ messageId: undefined }))).toContain("message ID");
  });
  it("never sends an event time in the future", () => {
    // The clamp reads the real clock, so this one test does too.
    const future = iso(Date.now() + 3_600_000);
    const r = toOpenAiEvent(event({ timestamp: future, receivedAt: future }), props());
    expect("event" in r && (r.event as any).timestamp_ms).toBeLessThanOrEqual(Date.now());
  });
});

describe("destination function", () => {
  const ctxFor = (p: Record<string, unknown>, fetch: any) => ({
    props: p,
    fetch,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    store: {} as any,
    getWarehouse: vi.fn(),
  });
  // The mapper reads the real clock, so give events a fresh time.
  const fresh = (o: Record<string, any> = {}) =>
    event({ timestamp: iso(Date.now() - 1000), receivedAt: iso(Date.now()), ...o });
  const run = (e: any, p: Record<string, unknown>, fetch: any) => (OpenAiAdsDestination as any)(e, ctxFor(p, fetch));
  const answer = (status: number, body: unknown = {}) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const cfg = { conversionsApiKey: KEY, pixelId: "px_test" };

  it("posts one authenticated event to the Conversions API", async () => {
    const fetch = answer(200, { accepted_events: 1 });
    await run(fresh(), cfg, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe(`${openAiConversionsUrl}?pid=px_test`);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(Object.keys(opts).sort()).toEqual(["body", "headers", "method"]);
    const body = JSON.parse(opts.body);
    expect(body.integration_source).toBe("jitsu");
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ id: "msg-1", type: "order_created" });
  });
  it("filters like the other destinations: track only by default, * for everything, or named events", async () => {
    const page = fresh({ type: "page", event: undefined });
    for (const [events, sent] of [
      ["", false],
      ["*", true],
      ["page", true],
      ["Order Completed", false],
    ] as const) {
      const fetch = answer(200);
      await run(page, { ...cfg, events }, fetch);
      expect(fetch).toHaveBeenCalledTimes(sent ? 1 : 0);
    }
    const fetch = answer(200);
    await run(fresh({ type: "identify", event: undefined }), { ...cfg, events: "*" }, fetch);
    await run(fresh(), { ...cfg, events: "Other" }, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not call OpenAI for a skipped event, and says why at debug level", async () => {
    const fetch = answer(200);
    const ctx = ctxFor(cfg, fetch);
    await (OpenAiAdsDestination as any)(fresh({ context: { page: undefined } }), ctx);
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.log.debug).toHaveBeenCalledWith(expect.stringContaining("not sent"));
  });
  it("fails with a clear message when the pixel, the key or the settings are missing or invalid", async () => {
    await expect(run(fresh(), { conversionsApiKey: KEY }, answer(200))).rejects.toThrow("Pixel ID");
    await expect(run(fresh(), { pixelId: "px_test" }, answer(200))).rejects.toThrow("Conversions API key");
    await expect(run(fresh(), { ...cfg, pixelId: "bad pixel!" }, answer(200))).rejects.toThrow("settings are invalid");
  });
  it("does not retry a refusal that would fail the same way again", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const err = await run(fresh(), cfg, answer(status, { error: { code: "invalid_request" } })).catch(e => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(RetryError);
      expect(err.message).toContain(`HTTP ${status}`);
    }
  });
  it("tells the user what to check when OpenAI refuses the pixel or the key, and only then", async () => {
    for (const status of [401, 403]) {
      const err = await run(fresh(), cfg, answer(status, { error: { message: "403: unknown pid", code: null } })).catch(
        e => e
      );
      expect(err.message).toBe(
        `OpenAI Ads API error: HTTP ${status}. Check the Pixel ID and the Conversions API key on the destination`
      );
      expect(err.message).not.toContain("unknown pid");
    }
    for (const status of [400, 404, 422]) {
      const err = await run(fresh(), cfg, answer(status, { error: { code: "invalid_request" } })).catch(e => e);
      expect(err.message).not.toContain("Check the Pixel ID");
    }
  });
  it("retries rate limiting, server errors and lost connections with the same event id", async () => {
    for (const status of [429, 500, 502, 503]) {
      const err = await run(fresh(), cfg, answer(status, { error: { code: "server_error" } })).catch(e => e);
      expect(err).toBeInstanceOf(RetryError);
    }
    const lost = await run(fresh(), cfg, vi.fn().mockRejectedValue(new Error("socket hang up"))).catch(e => e);
    expect(lost).toBeInstanceOf(RetryError);
  });
  it("reports per-event error codes but never the key or the event", async () => {
    const body = {
      error: { code: "invalid_request", param: "events", errors: [{ code: "invalid_event", param: "events[0].user" }] },
    };
    const err = await run(fresh(), cfg, answer(400, body)).catch(e => e);
    expect(err.message).toBe(
      'OpenAI Ads API error: HTTP 400 (invalid_request) [{"code":"invalid_event","param":"events[0].user"}]'
    );
    for (const secret of [KEY, "dave@example.com", sha("dave@example.com")]) expect(err.message).not.toContain(secret);
  });
});

describe("settings", () => {
  it("keeps the Reverse ETL credentials exactly as they were and ignores event settings", () => {
    const saved = {
      conversionsApiKey: " k-1 ",
      pixelId: "px_1",
      events: "*",
      eventMappings: ["a=custom"],
      actionSource: "other",
    };
    expect(OpenAiAdsCredentials.parse(saved)).toEqual({ conversionsApiKey: "k-1" });
  });
  it("defaults the event settings and validates the pixel", () => {
    expect(OpenAiAdsDestinationCredentials.parse({ conversionsApiKey: "k" })).toMatchObject({
      events: "",
      actionSource: "web",
      phoneFieldName: "",
    });
    expect(OpenAiAdsDestinationCredentials.safeParse({ pixelId: "has space" }).success).toBe(false);
    // Empty is "not set": a Reverse ETL-only destination keeps it empty, and an event connection reports it missing.
    expect(OpenAiAdsDestinationCredentials.parse({ pixelId: "  " }).pixelId).toBe("");
  });
  it("registers the function under the id rotor derives from the destination type", () => {
    expect(getBuiltinFunction("builtin.destination.openai-ads")).toBe(OpenAiAdsDestination);
  });
});
