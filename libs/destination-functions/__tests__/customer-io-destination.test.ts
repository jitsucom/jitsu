import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NoRetryError, RetryError } from "@jitsu/functions-lib";
import CustomerIoDestination from "../src/functions/customer-io-destination";
import { CUSTOMER_IO_HOSTS, CustomerIoCredentials } from "../src/meta";
import { getBuiltinFunction } from "../src";

const KEY = "sk_us_fake_test_key";

const answer = (status: number, body: unknown = { success: true }) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

function ctxFor(fetch: any, props: Record<string, unknown> = {}) {
  return {
    props: CustomerIoCredentials.parse({ apiKey: KEY, ...props }),
    fetch,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    store: {},
    getWarehouse: vi.fn(),
  } as any;
}

const track = (extra: Record<string, unknown> = {}): any => ({
  type: "track",
  event: "Order Completed",
  messageId: "msg-1",
  userId: "user-1",
  anonymousId: "anon-1",
  properties: { total: 42 },
  ...extra,
});

const run = (event: any, fetch: any, props: Record<string, unknown> = {}) =>
  (CustomerIoDestination as any)(event, ctxFor(fetch, props));

const sentBody = (fetch: any) => JSON.parse(fetch.mock.calls[0][1].body);

describe("customer-io credentials", () => {
  it("defaults the region to US", () => {
    expect(CustomerIoCredentials.parse({ apiKey: KEY }).region).toBe("US");
  });
  it("accepts US and EU only", () => {
    expect(CustomerIoCredentials.parse({ apiKey: KEY, region: "EU" }).region).toBe("EU");
    expect(() => CustomerIoCredentials.parse({ apiKey: KEY, region: "https://evil.example" })).toThrow();
  });
  it("requires an api key", () => {
    expect(() => CustomerIoCredentials.parse({})).toThrow();
  });
});

describe("customer-io registration", () => {
  it("is registered under builtin.destination.customer-io", () => {
    expect(getBuiltinFunction("builtin.destination.customer-io")).toBe(CustomerIoDestination);
  });
});

describe("customer-io request", () => {
  it("posts to the US host with bearer auth and strict mode", async () => {
    const fetch = answer(200);
    await run(track(), fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://cdp.customer.io/v1/track");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.headers["X-Strict-Mode"]).toBe("1");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("posts to the EU host when the region is EU", async () => {
    const fetch = answer(200);
    await run(track(), fetch, { region: "EU" });
    expect(fetch.mock.calls[0][0]).toBe(`${CUSTOMER_IO_HOSTS.EU}/v1/track`);
  });

  it.each(["identify", "track", "page", "screen", "group", "alias"])("uses the /v1/%s path", async type => {
    const fetch = answer(200);
    await run(track({ type }), fetch);
    expect(fetch.mock.calls[0][0]).toBe(`https://cdp.customer.io/v1/${type}`);
  });

  it("sends the event as is, minus writeKey", async () => {
    const fetch = answer(200);
    await run(track({ writeKey: "js.stream:secret", context: { ip: "203.0.113.5" } }), fetch);
    const body = sentBody(fetch);
    expect(body.writeKey).toBeUndefined();
    expect(body).toMatchObject({
      type: "track",
      event: "Order Completed",
      userId: "user-1",
      anonymousId: "anon-1",
      properties: { total: 42 },
      context: { ip: "203.0.113.5" },
    });
  });

  it("does not send an unsupported event type", async () => {
    const fetch = answer(200);
    await run(track({ type: "something-else" }), fetch);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not log the api key", async () => {
    const ctx = ctxFor(answer(200));
    await (CustomerIoDestination as any)(track(), ctx);
    const logged = JSON.stringify(Object.values(ctx.log).flatMap((f: any) => f.mock.calls));
    expect(logged).not.toContain(KEY);
  });
});

describe("customer-io messageId rule", () => {
  const sha = (v: string) => createHash("sha256").update(v).digest("hex");

  it("keeps a 191-character messageId", async () => {
    const fetch = answer(200);
    const id = "a".repeat(191);
    await run(track({ messageId: id }), fetch);
    expect(sentBody(fetch).messageId).toBe(id);
  });

  it("hashes a 192-character messageId to 64 hex characters", async () => {
    const fetch = answer(200);
    const id = "b".repeat(192);
    await run(track({ messageId: id }), fetch);
    const sent = sentBody(fetch).messageId;
    expect(sent).toBe(sha(id));
    expect(sent).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across calls (retries keep the same id)", async () => {
    const id = "c".repeat(300);
    const f1 = answer(200);
    const f2 = answer(200);
    await run(track({ messageId: id }), f1);
    await run(track({ messageId: id }), f2);
    expect(sentBody(f1).messageId).toBe(sentBody(f2).messageId);
  });

  it("does not modify the original event", async () => {
    const id = "d".repeat(250);
    const event = track({ messageId: id });
    await run(event, answer(200));
    expect(event.messageId).toBe(id);
  });

  it("leaves a missing or non-string messageId alone", async () => {
    const f1 = answer(200);
    const e = track();
    delete e.messageId;
    await run(e, f1);
    expect("messageId" in sentBody(f1)).toBe(false);
    const f2 = answer(200);
    await run(track({ messageId: 12345 }), f2);
    expect(sentBody(f2).messageId).toBe(12345);
  });
});

describe("customer-io error mapping", () => {
  it("resolves on 200", async () => {
    await expect(run(track(), answer(200))).resolves.toBeUndefined();
  });

  it("resolves on any 2xx", async () => {
    await expect(run(track(), answer(202, {}))).resolves.toBeUndefined();
  });

  it("throws NoRetryError on 400, with the response body", async () => {
    const body = { errors: [{ field: "messageId", message: "cannot be longer than 191 characters" }] };
    const err = await run(track(), answer(400, body)).catch((e: any) => e);
    expect(err).toBeInstanceOf(NoRetryError);
    expect(err.message).toContain("400");
    expect(err.message).toContain("cannot be longer than 191 characters");
  });

  it.each([401, 403, 404, 429, 500, 502, 503])("throws RetryError on %i", async status => {
    const err = await run(track(), answer(status, { errors: [] })).catch((e: any) => e);
    expect(err).toBeInstanceOf(RetryError);
    expect(err.message).toContain(String(status));
  });

  it("wraps a network failure in RetryError", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("connect ECONNRESET"));
    const err = await run(track(), fetch).catch((e: any) => e);
    expect(err).toBeInstanceOf(RetryError);
    expect(err.message).toContain("ECONNRESET");
  });

  it("does not put the api key in an error message", async () => {
    const err = await run(track(), answer(401, { errors: [] })).catch((e: any) => e);
    expect(err.message).not.toContain(KEY);
  });
});

// Real-service check. Runs only when a Customer.io private key is provided, e.g.
//   TEST_CUSTOMER_IO_API_KEY=sk_... [TEST_CUSTOMER_IO_REGION=EU] pnpm exec vitest run customer-io-destination
const liveKey = process.env.TEST_CUSTOMER_IO_API_KEY;
describe.skipIf(!liveKey)("customer-io (live service)", () => {
  const region = process.env.TEST_CUSTOMER_IO_REGION === "EU" ? "EU" : "US";
  const liveCtx = (apiKey: string) => ctxFor(fetch, { apiKey, region });
  const id = `jitsu-live-${Date.now()}`;

  it("accepts identify, track and page", async () => {
    for (const e of [
      { type: "identify", userId: id, traits: { probe: true } },
      { type: "track", userId: id, event: "live_probe", properties: { n: 1 } },
      { type: "page", userId: id, name: "Live probe", properties: { url: "https://example.com/" } },
    ]) {
      await expect((CustomerIoDestination as any)(e, liveCtx(liveKey!))).resolves.toBeUndefined();
    }
  });

  it("accepts a 250-character messageId because the destination hashes it", async () => {
    await expect(
      (CustomerIoDestination as any)(
        { type: "track", userId: id, event: "live_long_id", messageId: "x".repeat(250) },
        liveCtx(liveKey!)
      )
    ).resolves.toBeUndefined();
  });

  it("fails visibly with a wrong key (not silently)", async () => {
    const err = await (CustomerIoDestination as any)({ type: "track", userId: id, event: "x" }, liveCtx("sk_wrong"))
      .then(() => undefined)
      .catch((e: any) => e);
    expect(err).toBeInstanceOf(RetryError);
    expect(err.message).toContain("401");
  });

  it("returns NoRetryError for a payload over 32KB", async () => {
    const err = await (CustomerIoDestination as any)(
      { type: "track", userId: id, event: "big", properties: { blob: "x".repeat(33000) } },
      liveCtx(liveKey!)
    )
      .then(() => undefined)
      .catch((e: any) => e);
    expect(err).toBeInstanceOf(NoRetryError);
  });
});
