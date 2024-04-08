import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import MixpanelDestination from "../src/functions/mixpanel-destination";
import { eventsSequence } from "./lib/test-data";
import { MixpanelCredentials } from "../src/meta";

test("mixpanel-destination-integration", async () => {
  if (!process.env.TEST_MIXPANEL_DESTINATION) {
    console.log("Skipping mixpanel destination integration test - TEST_MIXPANEL_DESTINATION is not set");
    return;
  }
  const events = eventsSequence();
  const opts: TestOptions<MixpanelCredentials> = {
    func: MixpanelDestination,
    configEnvVar: "TEST_MIXPANEL_DESTINATION",
    events: events,
  };
  await testJitsuFunction(opts);
});

test("mixpanel-destination-unit", () => {
  //implement later, when testing library is ready to mock fetch
});
