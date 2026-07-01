import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { ResendCredentials } from "../src/meta";
import ResendDestination from "../src/functions/resend-destination";
import { setGlobalLogLevel, setServerLogColoring } from "juava";
import { createMemoryStore } from "./lib/mem-store";
import { emailContactTestEvents } from "./lib/email-contacts-test-data";

setServerLogColoring(true);
setGlobalLogLevel("debug");

// Live test. Set TEST_RESEND_DESTINATION_CONFIG to a JSON config, e.g.:
//   { "apiKey": "re_xxx", "audiences": "__TEST", "resolveEmailFromUserId": true }
// then run: pnpm --filter @jitsu/destination-functions test resend
test("test", async () => {
  if (!process.env.TEST_RESEND_DESTINATION_CONFIG) {
    console.log("TEST_RESEND_DESTINATION_CONFIG is not set, skipping test");
    return;
  }
  const opts: TestOptions<ResendCredentials> = {
    func: ResendDestination,
    configEnvVar: "TEST_RESEND_DESTINATION_CONFIG",
    chainCtx: { store: createMemoryStore() } as any,
    events: emailContactTestEvents("resendAudiences"),
  };
  await testJitsuFunction(opts);
}, 60000);
