import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { SendgridCredentials } from "../src/meta";
import SendgridDestination from "../src/functions/sendgrid-destination";
import { setGlobalLogLevel, setServerLogColoring } from "juava";
import { createMemoryStore } from "./lib/mem-store";
import { emailContactTestEvents } from "./lib/email-contacts-test-data";

setServerLogColoring(true);
setGlobalLogLevel("debug");

// Live test. Set TEST_SENDGRID_DESTINATION_CONFIG to a JSON config, e.g.:
//   { "apiKey": "SG.xxx", "lists": "Customers, Beta", "resolveEmailFromUserId": true }
// then run: pnpm --filter @jitsu/destination-functions test sendgrid
test("test", async () => {
  if (!process.env.TEST_SENDGRID_DESTINATION_CONFIG) {
    console.log("TEST_SENDGRID_DESTINATION_CONFIG is not set, skipping test");
    return;
  }
  const opts: TestOptions<SendgridCredentials> = {
    func: SendgridDestination,
    configEnvVar: "TEST_SENDGRID_DESTINATION_CONFIG",
    chainCtx: { store: createMemoryStore() } as any,
    events: emailContactTestEvents("sendgridLists"),
  };
  await testJitsuFunction(opts);
}, 60000);
