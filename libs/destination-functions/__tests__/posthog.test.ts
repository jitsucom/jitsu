import { vi } from "vitest";
import { eventsSequence } from "./lib/test-data";
import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import PosthogDestination from "../src/functions/posthog-destination";
import { RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

test("posthog-destination-integration", async () => {
  if (!process.env.TEST_POSTHOG_DESTINATION) {
    console.log("Skipping mixpanel destination integration test - TEST_MIXPANEL_DESTINATION is not set");
    return;
  }
  const opts: TestOptions = {
    func: PosthogDestination,
    configEnvVar: "TEST_POSTHOG_DESTINATION",
    events: eventsSequence(),
  };
  await testJitsuFunction(opts);
});

const trackEvent: AnalyticsServerEvent = {
  type: "track",
  event: "test-event",
  anonymousId: "anon-1",
  messageId: "m-1",
  timestamp: new Date().toISOString(),
  context: {},
  properties: {},
};

// The functions fetch returns node-fetch-style responses: body is a Node
// Readable (destroy(), no cancel()). posthog-node 5.x calls
// response.body?.cancel() on it, so passing the response through unadapted
// fails every delivery ("response.body?.cancel is not a function") - the
// stubs carry such a body to keep that regression covered.
const nodeStyleBody = { destroy: () => {} } as any;

test("posthog-destination-delivery-error", async () => {
  // posthog's logFlushError console.error's failures (with the full response
  // body) from shutdown()'s internal flush; the destination flushes explicitly
  // beforehand precisely so that path stays silent.
  const consoleError = vi.spyOn(console, "error");
  // posthog-node only enqueues events in capture(); delivery happens on
  // shutdown(), which swallows fetch errors and emits them on the "error"
  // event. The destination must surface them as RetryError. 413 is used
  // because posthog-node fails it in a single attempt (no internal retries).
  const failingFetch = async () => ({
    status: 413,
    text: async () => "payload too large",
    json: async () => ({}),
    body: nodeStyleBody,
  });
  await expect(
    testJitsuFunction({
      func: PosthogDestination,
      config: { key: "phc_test", enableAnonymousUserProfiles: true },
      events: [trackEvent],
      chainCtx: { fetch: failingFetch } as any,
    })
  ).rejects.toThrow(RetryError);
  const flushSpam = consoleError.mock.calls.filter(args => String(args[0]).includes("Error while flushing PostHog"));
  expect(flushSpam).toEqual([]);
  consoleError.mockRestore();
});

test("posthog-destination-schemeless-host", async () => {
  // A host configured without a scheme ("us.posthog.com") must be normalized to
  // https:// - otherwise posthog-node builds a schemeless request URL, fetch throws,
  // and the resulting network error is both retried (slow) and re-logged by
  // shutdown()'s drain (spam). The stub mimics real fetch by rejecting schemeless URLs.
  const consoleError = vi.spyOn(console, "error");
  const seenUrls: string[] = [];
  const urlValidatingFetch = async (url: string) => {
    new URL(url); // real fetch throws on a schemeless URL; reproduce that here
    seenUrls.push(url);
    return {
      status: 200,
      text: async () => "ok",
      json: async () => ({ status: 1 }),
      body: nodeStyleBody,
    };
  };
  await expect(
    testJitsuFunction({
      func: PosthogDestination,
      config: { key: "phc_test", host: "us.posthog.com", enableAnonymousUserProfiles: true },
      events: [trackEvent],
      chainCtx: { fetch: urlValidatingFetch } as any,
    })
  ).resolves.toEqual([]);
  expect(seenUrls.length).toBeGreaterThan(0);
  expect(seenUrls.every(u => u.startsWith("https://us.posthog.com/"))).toBe(true);
  const flushSpam = consoleError.mock.calls.filter(args => String(args[0]).includes("Error while flushing PostHog"));
  expect(flushSpam).toEqual([]);
  consoleError.mockRestore();
});

test("posthog-destination-network-error-no-spam", async () => {
  // A genuine network failure (valid host, but the transport itself throws: DNS,
  // connection refused, TLS, timeout) must still surface as RetryError WITHOUT
  // console spam. posthog keeps network-errored batches queued (unlike HTTP errors),
  // so shutdown()'s drain would re-flush and console.error them - the destination
  // must not let that happen.
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const throwingFetch = async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:443");
  };
  await expect(
    testJitsuFunction({
      func: PosthogDestination,
      config: { key: "phc_test", host: "https://us.i.posthog.com", enableAnonymousUserProfiles: true },
      events: [trackEvent],
      chainCtx: { fetch: throwingFetch } as any,
    })
  ).rejects.toThrow(RetryError);
  const flushSpam = consoleError.mock.calls.filter(args => String(args[0]).includes("Error while flushing PostHog"));
  expect(flushSpam).toEqual([]);
  consoleError.mockRestore();
});

test("posthog-destination-delivery-success", async () => {
  const okFetch = async () => ({
    status: 200,
    text: async () => "ok",
    json: async () => ({ status: 1 }),
    body: nodeStyleBody,
  });
  await expect(
    testJitsuFunction({
      func: PosthogDestination,
      config: { key: "phc_test", enableAnonymousUserProfiles: true },
      events: [trackEvent],
      chainCtx: { fetch: okFetch } as any,
    })
  ).resolves.toEqual([]);
});
