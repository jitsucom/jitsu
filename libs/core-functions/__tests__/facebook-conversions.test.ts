//Check that the hashing is consistent with FB examples
//https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters#email
import FacebookConversionsApi, { facebookHash } from "../src/functions/facebook-conversions";
import { eventsSequence } from "./lib/test-data";
import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { FacebookConversionApiCredentials } from "../src/meta";

test("hashConsistency", () => {
  expect(facebookHash("john_smith@gmail.com")).toBe("62a14e44f765419d10fea99367361a727c12365e2520f32218d505ed9aa0f62f");
  expect(facebookHash("16505551212")).toBe("e323ec626319ca94ee8bff2e4c87cf613be6ea19919ed1364124e16807ab3176");
});

test("test", async () => {
  if (!process.env.TEST_FACEBOOK_CONVERSION_API_DESTINATION) {
    console.log("Skipping facebook destination integration test - TEST_FACEBOOK_CONVERSION_API_DESTINATION is not set");
    return;
  }
  const events = eventsSequence().map(e => {
    e.context.clientIds = {
      fbp: "fb.1.1699639746924.1914402145",
    };
    return e;
  });
  const opts: TestOptions<FacebookConversionApiCredentials> = {
    funcWrapper: FacebookConversionsApi,
    configEnvVar: "TEST_FACEBOOK_CONVERSION_API_DESTINATION",
    events: events,
  };
  await testJitsuFunction(opts);
});
