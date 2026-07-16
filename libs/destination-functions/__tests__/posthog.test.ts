import { vi } from "vitest";
import { eventsSequence } from "./lib/test-data";
import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import PosthogDestination from "../src/functions/posthog-destination";
import { RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

//TEST_POSTHOG_DESTINATION={key: 'phc_tnUHCp3pRSnx9hR2mL1i1O9luW2ktkHvg4tyOOc15B1', enableAnonymousUserProfiles: true, sendIdentifyEvents: true}
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
