import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { describe, expect, test, vi } from "vitest";
import type { Ga4Credentials } from "../src/meta";
import Ga4Destination from "../src/functions/ga4-destination";
import { testJitsuFunction, type TestOptions } from "./lib/testing-lib";

type SendEventOptions = {
  legacyUrl?: string;
  onRequest?: (url: string) => void;
};

async function sendEvent(
  context: AnalyticsServerEvent["context"],
  ua?: Record<string, any>,
  options: SendEventOptions = {}
) {
  let request: Record<string, any> | undefined;
  const event: AnalyticsServerEvent = {
    type: "track",
    event: "Test Event",
    messageId: "message-id",
    anonymousId: "anonymous-id",
    timestamp: "2026-07-14T12:00:00.000Z",
    context,
  };

  await Ga4Destination(event, {
    props: {
      apiSecret: "secret",
      measurementId: "G-TEST123",
      events: "",
      ...(options.legacyUrl ? { url: options.legacyUrl } : {}),
    },
    ua,
    fetch: async (url: string, opts?: { body?: string | Uint8Array }) => {
      options.onRequest?.(url);
      request = JSON.parse(opts?.body as string);
      return new Response(null, { status: 204 });
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
  } as any);

  return request;
}

test("ignores a legacy custom URL", async () => {
  let requestUrl: string | undefined;

  await sendEvent({}, undefined, {
    legacyUrl: "https://attacker.example.com/collect",
    onRequest: url => {
      requestUrl = url;
    },
  });

  expect(requestUrl).toBe("https://www.google-analytics.com/mp/collect?api_secret=secret&measurement_id=G-TEST123");
});

describe("GA4 request context", () => {
  test("sends explicit device context and the raw user agent", async () => {
    const request = await sendEvent(
      {
        userAgent: "raw user agent",
        locale: "en-US",
        screen: { width: 1179, height: 2556 },
        os: { name: "iOS", version: "17.5" },
        device: { type: "mobile", model: "iPhone 15 Pro", manufacturer: "Apple" },
      },
      {
        browser: { name: "Mobile Safari", version: "17.5" },
        os: { name: "Parsed OS", version: "1" },
        device: { type: "desktop", model: "Parsed Model", vendor: "Parsed Brand" },
      }
    );

    expect(request).toMatchObject({
      user_agent: "raw user agent",
      device: {
        category: "mobile",
        language: "en-US",
        screen_resolution: "1179x2556",
        operating_system: "iOS",
        operating_system_version: "17.5",
        model: "iPhone 15 Pro",
        brand: "Apple",
        browser: "Mobile Safari",
        browser_version: "17.5",
      },
    });
  });

  test("fills missing structured fields from the parsed user agent", async () => {
    const request = await sendEvent(
      { userAgent: "fallback raw user agent" },
      {
        browser: { name: "Chrome", version: "136.0.7103.60" },
        os: { name: "Android", version: "14" },
        device: { type: "mobile", model: "Pixel 9 Pro", vendor: "Google" },
      }
    );

    expect(request).toMatchObject({
      user_agent: "fallback raw user agent",
      device: {
        category: "mobile",
        operating_system: "Android",
        operating_system_version: "14",
        model: "Pixel 9 Pro",
        brand: "Google",
        browser: "Chrome",
        browser_version: "136.0.7103.60",
      },
    });
  });

  test("sends structured location and IP override", async () => {
    const request = await sendEvent({
      ip: "203.0.113.10",
      geo: {
        city: { name: "New York" },
        country: { code: "US" },
        region: { code: "NY" },
      },
    } as any);

    expect(request).toMatchObject({
      user_location: {
        city: "New York",
        region_id: "US-NY",
        country_id: "US",
      },
      ip_override: "203.0.113.10",
    });
  });

  test("preserves an ISO 3166-2 region code", async () => {
    const request = await sendEvent({
      geo: {
        country: { code: "CA" },
        region: { code: "CA-BC" },
      },
    } as any);

    expect(request?.user_location).toEqual({
      country_id: "CA",
      region_id: "CA-BC",
    });
  });

  test("normalizes boolean GA consent preferences", async () => {
    const request = await sendEvent({
      consent: {
        categoryPreferences: {
          ad_user_data: true,
          ad_personalization: false,
        },
      },
    });

    expect(request?.consent).toEqual({
      ad_user_data: "GRANTED",
      ad_personalization: "DENIED",
    });
  });

  test("passes through valid GA consent states", async () => {
    const request = await sendEvent({
      consent: {
        categoryPreferences: {
          ad_user_data: "DENIED",
          ad_personalization: "GRANTED",
        },
      },
    });

    expect(request?.consent).toEqual({
      ad_user_data: "DENIED",
      ad_personalization: "GRANTED",
    });
  });

  test("omits empty device metadata and incomplete screen resolution", async () => {
    const request = await sendEvent({
      screen: { width: 1179 },
      ip: "",
      geo: {},
      consent: {
        categoryPreferences: {
          analytics: true,
          ad_user_data: "yes",
          ad_personalization: null,
        },
      },
    } as any);

    expect(request).not.toHaveProperty("device");
    expect(request).not.toHaveProperty("user_agent");
    expect(request).not.toHaveProperty("user_location");
    expect(request).not.toHaveProperty("ip_override");
    expect(request).not.toHaveProperty("consent");
  });
});

// Live test. Set TEST_GA4_DESTINATION_CONFIG to JSON credentials, then run:
// TEST_GA4_DESTINATION_CONFIG='{ "apiSecret": "...", "measurementId": "G-..." }' pnpm --filter @jitsu/destination-functions exec vitest run __tests__/ga4-destination.test.ts -t ga4-destination-integration
test("ga4-destination-integration", async () => {
  if (!process.env.TEST_GA4_DESTINATION_CONFIG) {
    console.log("TEST_GA4_DESTINATION_CONFIG is not set, skipping test");
    return;
  }

  const now = Date.now();
  const event = {
    type: "track",
    event: "Jitsu GA4 Destination Live Test",
    messageId: `ga4-live-test-${now}`,
    anonymousId: `jitsu-ga4-live-test-${now}`,
    timestamp: new Date(now).toISOString(),
    context: {
      ip: "203.0.113.10",
      userAgent: "Jitsu GA4 Destination Live Test/1.0",
      locale: "en-US",
      screen: { width: 1280, height: 720 },
      os: { name: "Test OS", version: "1.0" },
      device: { type: "desktop", manufacturer: "Jitsu", model: "GA4 Live Test" },
      geo: {
        city: { name: "New York" },
        country: { code: "US", name: "United States", isEU: false },
        region: { code: "NY", name: "New York" },
      },
      consent: {
        categoryPreferences: { ad_user_data: false, ad_personalization: false },
      },
    },
  } as AnalyticsServerEvent;

  const opts: TestOptions<Ga4Credentials> = {
    func: Ga4Destination,
    configEnvVar: "TEST_GA4_DESTINATION_CONFIG",
    events: [event],
  };
  await testJitsuFunction(opts);
}, 60000);
