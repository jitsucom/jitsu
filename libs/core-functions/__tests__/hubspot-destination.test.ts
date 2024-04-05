import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { eventsSequence } from "./lib/test-data";
import { HubspotCredentials } from "../src/meta";
import { HubspotDestination } from "../src/functions/hubspot-destination";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { undefined } from "zod";

test("hubspot-integration-test", async () => {
  if (!process.env.TEST_HUBSPOT_DESTINATIONS) {
    console.log("Skipping mixpanel destination integration test - TEST_HUBSPOT_DESTINATIONS is not set");
    return;
  }
  const groupEvent: AnalyticsServerEvent = {
    context: undefined,
    messageId: "group1",
    type: "group",
    traits: {
      name: "Company 1",
    },
  };
  const events = [...eventsSequence(), groupEvent];
  const opts: TestOptions<HubspotCredentials> = {
    funcWrapper: HubspotDestination,
    configEnvVar: "TEST_HUBSPOT_DESTINATIONS",
    events: events,
  };
  await testJitsuFunction(opts);
});

// test("mixpanel-destination-unit", () => {љ
//   //implement later, when testing library is ready to mock fetch
// });
