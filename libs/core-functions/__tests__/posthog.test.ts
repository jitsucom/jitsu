import { eventsSequence } from "./lib/test-data";
import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import PosthogDestination from "../src/functions/posthog-destination";

//TEST_POSTHOG_DESTINATION={key: 'phc_tnUHCp3pRSnx9hR2mL1i1O9luW2ktkHvg4tyOOc15B1', enableAnonymousUserProfiles: true, sendIdentifyEvents: true}
test("posthog-destination-integration", async () => {
  if (!process.env.TEST_POSTHOG_DESTINATION) {
    console.log("Skipping mixpanel destination integration test - TEST_MIXPANEL_DESTINATION is not set");
    return;
  }
  const opts: TestOptions = {
    funcWrapper: PosthogDestination,
    configEnvVar: "TEST_POSTHOG_DESTINATION",
    events: eventsSequence(),
  };
  await testJitsuFunction(opts);
});

test("posthog-destination-unit", () => {
  //implement later, when testing library is ready to mock fetch
});
