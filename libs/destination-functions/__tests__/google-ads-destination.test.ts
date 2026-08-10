import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import type { TTLStore } from "@jitsu/protocols/functions";
import { expect, test, vi } from "vitest";
import { createMemoryStore, createStore } from "./lib/mem-store";
import { eventsSequence } from "./lib/test-data";
import { testJitsuFunction, type TestOptions } from "./lib/testing-lib";

vi.mock("../src/functions/lib/oauth", () => ({
  getOauthCreds: async () => ({ credentials: { access_token: "test-access-token" } }),
}));

// Imported after the mock so the function picks up the stubbed getOauthCreds.
const {
  default: GoogleAdsDestination,
  normalizeEmail,
  normalizePhoneE164,
  parseConversionActions,
} = await import("../src/functions/google-ads-destination");

const baseProps = {
  authorized: true,
  oauthIntegrationId: "jitsu-cloud-dst-google-ads",
  oauthConnectionId: "destination.test",
  api: "data-manager" as "data-manager" | "google-ads",
  customerId: "123-456-7890",
  loginCustomerId: "",
  conversionActionId: "987654321",
  conversionActions: [] as string[],
  conversionType: "conversion" as "conversion" | "enhancement",
  events: "*",
  eventSource: "WEB" as const,
  phoneFieldName: "phone",
  defaultPhoneCountryCode: "+1",
  developerToken: undefined as string | undefined,
  storeClickIds: true,
  validateOnly: false,
};

type SendOptions = {
  props?: Partial<typeof baseProps>;
  store?: TTLStore;
  response?: { status?: number; body?: any };
};

let destinationSeq = 0;

async function send(event: AnalyticsServerEvent, options: SendOptions = {}) {
  const capture: { url?: string; body?: any; headers?: any } = {};
  await GoogleAdsDestination(event, {
    props: { ...baseProps, ...(options.props || {}) },
    store: options.store || createMemoryStore(),
    // Unique per call so the module-level access-token cache never leaks between tests.
    destination: { id: `dst-${++destinationSeq}`, updatedAt: new Date(0) },
    geo: { country: { code: "US" }, postalCode: { code: "94103" } },
    fetch: async (url: string, opts?: { body?: string; headers?: Record<string, string> }) => {
      capture.url = url;
      capture.body = JSON.parse(opts?.body as string);
      capture.headers = opts?.headers;
      return new Response(JSON.stringify(options.response?.body ?? { requestId: "req-1" }), {
        status: options.response?.status ?? 200,
      });
    },
    log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  } as any);
  return capture;
}

function purchaseEvent(overrides: Partial<AnalyticsServerEvent> = {}): AnalyticsServerEvent {
  return {
    type: "track",
    event: "Order Completed",
    messageId: "message-id",
    anonymousId: "anon-1",
    timestamp: "2026-07-14T12:00:00.000Z",
    properties: { total: 42.5, currency: "USD", orderId: "order-99" },
    context: {
      ip: "10.0.0.1",
      userAgent: "test-agent",
      clientIds: { gclid: "test-gclid" },
      traits: { email: "John.Smith@example.com", phone: "+1 415 555 1212", firstName: "John", lastName: "Smith" },
      page: { url: "https://example.com/checkout" },
    },
    ...overrides,
  } as AnalyticsServerEvent;
}

test("normalizes PII the way Google requires before hashing", () => {
  //dots and +tags are insignificant on gmail only, so these two must collapse to one address
  expect(normalizeEmail("Jane.Doe+shopping@gmail.com")).toBe("janedoe@gmail.com");
  expect(normalizeEmail("Jane.Doe+shopping@example.com")).toBe("jane.doe+shopping@example.com");

  expect(normalizePhoneE164("+1 (415) 555-1212")).toBe("+14155551212");
  expect(normalizePhoneE164("0415 555 1212", "44")).toBe("+444155551212");
  //no country code means no valid E.164 number, so send nothing rather than something Google rejects
  expect(normalizePhoneE164("4155551212")).toBeUndefined();
});

test("parses per-event conversion actions and ignores malformed lines", () => {
  expect(parseConversionActions(["Order Completed=111", " Signed Up = 222 ", "garbage", "=333", "x="])).toEqual({
    "Order Completed": "111",
    "Signed Up": "222",
  });
});

test("builds a Data Manager payload", async () => {
  const { url, body, headers } = await send(purchaseEvent());

  expect(url).toBe("https://datamanager.googleapis.com/v1/events:ingest");
  expect(headers.Authorization).toBe("Bearer test-access-token");
  expect(body.destinations).toEqual([
    { operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" }, productDestinationId: "987654321" },
  ]);
  expect(body.encoding).toBe("HEX");

  const event = body.events[0];
  expect(event).toMatchObject({
    eventTimestamp: "2026-07-14T12:00:00.000Z",
    eventSource: "WEB",
    transactionId: "order-99",
    conversionValue: 42.5,
    currency: "USD",
    adIdentifiers: { gclid: "test-gclid" },
  });
  expect(event.eventDeviceInfo).toMatchObject({ ipAddress: "10.0.0.1", userAgent: "test-agent" });
  //email and phone are hashed; country and postal code travel in the clear, as Google expects
  expect(event.userData.userIdentifiers[0].emailAddress).toMatch(/^[a-f0-9]{64}$/);
  expect(event.userData.userIdentifiers[2].address).toMatchObject({ regionCode: "US", postalCode: "94103" });
  expect(JSON.stringify(body)).not.toContain("john.smith@example.com");
});

test("builds a legacy Google Ads payload from the same event", async () => {
  const { url, body, headers } = await send(purchaseEvent(), {
    props: { api: "google-ads", developerToken: "dev-token", loginCustomerId: "111-222-3333", eventSource: "IN_STORE" },
  });

  expect(url).toBe("https://googleads.googleapis.com/v22/customers/1234567890:uploadClickConversions");
  expect(headers["developer-token"]).toBe("dev-token");
  //the manager account travels as a header here, not in the body
  expect(headers["login-customer-id"]).toBe("1112223333");

  expect(body.conversions[0]).toMatchObject({
    conversionAction: "customers/1234567890/conversionActions/987654321",
    //this API wants "yyyy-mm-dd hh:mm:ss+hh:mm", not RFC3339
    conversionDateTime: "2026-07-14 12:00:00+00:00",
    currencyCode: "USD",
    orderId: "order-99",
    gclid: "test-gclid",
    userIpAddress: "10.0.0.1",
  });
  //identifiers use this API's own field names
  expect(body.conversions[0].userIdentifiers[0].hashedEmail).toMatch(/^[a-f0-9]{64}$/);
  //IN_STORE has no equivalent here, so the field is dropped rather than sent as something invalid
  expect(body.conversions[0].conversionEnvironment).toBeUndefined();
});

test("spells consent enums the way each API expects", async () => {
  const event = purchaseEvent();
  event.context.consent = { categoryPreferences: { ad_user_data: true, ad_personalization: false } };

  const dm = await send(event);
  expect(dm.body.events[0].consent).toEqual({ adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_DENIED" });

  const legacy = await send(event, { props: { api: "google-ads", developerToken: "dev-token" } });
  expect(legacy.body.conversions[0].consent).toEqual({ adUserData: "GRANTED", adPersonalization: "DENIED" });
});

test("routes an event to its per-event conversion action, else the default", async () => {
  const mapped = await send(purchaseEvent(), { props: { conversionActions: ["Order Completed=111222333"] } });
  expect(mapped.body.destinations[0].productDestinationId).toBe("111222333");

  const unmapped = await send(purchaseEvent({ event: "Some Other Event" }), {
    props: { conversionActions: ["Order Completed=111222333"] },
  });
  expect(unmapped.body.destinations[0].productDestinationId).toBe("987654321");
});

test("remembers a click id from an earlier event and replays it onto the conversion", async () => {
  const store = createMemoryStore();

  //a landing page view carrying ?gclid= — not a conversion itself, but the only place we see the id
  await send(
    {
      type: "page",
      messageId: "m1",
      anonymousId: "anon-42",
      timestamp: "2026-07-14T10:00:00.000Z",
      context: { page: { url: "https://example.com/?gclid=remembered-gclid&utm_source=google" } },
    } as any,
    { store, props: { events: "Order Completed" } }
  );

  //...then a conversion days later carrying no click id anywhere
  const conversion = purchaseEvent({ anonymousId: "anon-42" });
  conversion.context.clientIds = {};
  conversion.context.page = { url: "https://example.com/thank-you" };
  const replayed = await send(conversion, { store, props: { events: "Order Completed" } });
  expect(replayed.body.events[0].adIdentifiers).toEqual({ gclid: "remembered-gclid" });

  //a click id on the event itself always wins over the remembered one
  await store.set("gads_click:anon-1", { gclid: "stale-gclid" });
  const fresh = await send(purchaseEvent(), { store });
  expect(fresh.body.events[0].adIdentifiers).toEqual({ gclid: "test-gclid" });
});

test("still sends when the store is unusable", async () => {
  //createStore() throws on every operation — self-hosted Jitsu with no Mongo/Redis behaves this way
  const { body } = await send(purchaseEvent(), { store: createStore() });
  expect(body.events[0].adIdentifiers).toEqual({ gclid: "test-gclid" });
});

test("a remembered click id is copied onto the user's other identifiers", async () => {
  const store = createMemoryStore();
  //seen while anonymous...
  await send({ ...purchaseEvent(), userId: undefined, anonymousId: "anon-7" } as AnalyticsServerEvent, { store });
  //...then an event that ties the anonymous id to a user id
  const identified = purchaseEvent({ anonymousId: "anon-7", userId: "user-7" });
  identified.context.clientIds = {};
  identified.context.page = { url: "https://example.com/thank-you" };
  await send(identified, { store });

  //a later conversion from another device carries only the user id, and must still find the click id
  const otherDevice = purchaseEvent({ anonymousId: "anon-99", userId: "user-7" });
  otherDevice.context.clientIds = {};
  otherDevice.context.page = { url: "https://example.com/thank-you" };
  const { body } = await send(otherDevice, { store });
  expect(body.events[0].adIdentifiers).toEqual({ gclid: "test-gclid" });
});

test("skips events with nothing for Google to match on", async () => {
  const bare = { ...purchaseEvent(), context: {} } as AnalyticsServerEvent;
  expect((await send(bare)).url).toBeUndefined();

  //ctx.geo supplies country and postal code, but without a name they can't form an address identifier
  const geoOnly = { ...purchaseEvent(), context: { traits: {} } } as AnalyticsServerEvent;
  expect((await send(geoOnly)).url).toBeUndefined();
});

test("an IP is a usable identifier for Data Manager but not for the legacy API", async () => {
  const ipOnly = { ...purchaseEvent(), context: { ip: "10.0.0.1" } } as AnalyticsServerEvent;

  //Data Manager lists eventDeviceInfo.ipAddress among the identifiers it will match on
  const dm = await send(ipOnly);
  expect(dm.body.events[0].eventDeviceInfo.ipAddress).toBe("10.0.0.1");

  //the legacy API only takes userIpAddress alongside a click id or user identifiers, so sending an
  //IP-only row there is a guaranteed rejection
  const legacy = await send(ipOnly, { props: { api: "google-ads", developerToken: "dev-token" } });
  expect(legacy.url).toBeUndefined();
});

test("treats row-level rejections and server errors as failures", async () => {
  //both APIs can reject a row while still answering 200
  await expect(
    send(purchaseEvent(), {
      props: { api: "google-ads", developerToken: "dev-token" },
      response: { body: { partialFailureError: { code: 3, message: "invalid conversion action" } } },
    })
  ).rejects.toThrow(/invalid conversion action/);

  //a bad request will fail identically forever, so it must not be retried
  await expect(send(purchaseEvent(), { response: { status: 400, body: {} } })).rejects.toThrow(/400/);

  const retryable = send(purchaseEvent(), { response: { status: 503, body: {} } });
  await expect(retryable).rejects.toThrow(/503/);
  await retryable.catch(e => expect(e.name).toBe("RetryError"));
});

test("falls back to the Jitsu-managed developer token from the environment", async () => {
  //a developer token identifies the calling application, not the advertiser, so Jitsu supplies one.
  //Set it explicitly: vitest loads .env.local, which on a dev machine already carries a real token.
  const previous = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "env-dev-token";
  try {
    const fromEnv = await send(purchaseEvent(), { props: { api: "google-ads" } });
    expect(fromEnv.headers["developer-token"]).toBe("env-dev-token");

    const explicit = await send(purchaseEvent(), { props: { api: "google-ads", developerToken: "explicit-token" } });
    expect(explicit.headers["developer-token"]).toBe("explicit-token");
  } finally {
    if (previous === undefined) {
      delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    } else {
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN = previous;
    }
  }
});

test("enhancement mode uses the adjustment service and keys on the order ID", async () => {
  const dm = await send(purchaseEvent(), { props: { conversionType: "enhancement" } });
  expect(dm.body.events[0].transactionId).toBe("order-99");

  const { url, body } = await send(purchaseEvent(), {
    props: { api: "google-ads", developerToken: "dev-token", conversionType: "enhancement" },
  });
  expect(url).toBe("https://googleads.googleapis.com/v22/customers/1234567890:uploadConversionAdjustments");
  expect(body.conversionAdjustments[0]).toMatchObject({
    adjustmentType: "ENHANCEMENT",
    conversionAction: "customers/1234567890/conversionActions/987654321",
    adjustmentDateTime: "2026-07-14 12:00:00+00:00",
    orderId: "order-99",
    userAgent: "test-agent",
  });
  //an enhancement attaches user data to an existing conversion — no click id, no value
  expect(body.conversionAdjustments[0].gclid).toBeUndefined();
  expect(body.conversionAdjustments[0].conversionValue).toBeUndefined();
});

test("enhancement mode skips events it could never match", async () => {
  //messageId is a fine dedup key for a new conversion but can never match a tag-recorded one,
  //so the messageId fallback must not leak into enhancement mode
  const noOrderId = purchaseEvent();
  noOrderId.properties = { total: 10, currency: "USD" };
  expect((await send(noOrderId, { props: { conversionType: "enhancement" } })).url).toBeUndefined();
  //...while a normal conversion is happy to use it
  expect((await send(noOrderId)).body.events[0].transactionId).toBe("message-id");

  //an enhancement whose only payload is a join key adds nothing
  const noUserData = purchaseEvent();
  noUserData.context.traits = {};
  expect((await send(noUserData, { props: { conversionType: "enhancement" } })).url).toBeUndefined();
});

test("integration test", async () => {
  if (!process.env.TEST_GOOGLE_ADS_DESTINATION) {
    console.log("Skipping google-ads destination integration test - TEST_GOOGLE_ADS_DESTINATION is not set");
    return;
  }
  //Set validateOnly:true in the config so Google validates the payload without recording conversions.
  const opts: TestOptions<any> = {
    func: GoogleAdsDestination,
    configEnvVar: "TEST_GOOGLE_ADS_DESTINATION",
    events: eventsSequence(),
  };
  await testJitsuFunction(opts);
});
