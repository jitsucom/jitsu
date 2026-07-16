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

test("posthog-destination-delivery-error", async () => {
  // posthog-node only enqueues events in capture(); delivery happens on
  // shutdown(), which swallows fetch errors and emits them on the "error"
  // event. The destination must surface them as RetryError. 413 is used
  // because posthog-node fails it in a single attempt (no internal retries).
  const failingFetch = async () => ({
    status: 413,
    text: async () => "payload too large",
    json: async () => ({}),
  });
  await expect(
    testJitsuFunction({
      func: PosthogDestination,
      config: { key: "phc_test", enableAnonymousUserProfiles: true },
      events: [trackEvent],
      chainCtx: { fetch: failingFetch } as any,
    })
  ).rejects.toThrow(RetryError);
});

test("posthog-destination-delivery-success", async () => {
  const okFetch = async () => ({
    status: 200,
    text: async () => "ok",
    json: async () => ({ status: 1 }),
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
