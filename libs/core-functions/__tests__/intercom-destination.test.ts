import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { FacebookConversionApiCredentials } from "../src/meta";
import FacebookConversionsApi from "../src/functions/facebook-conversions";

test("test", async () => {
  const opts: TestOptions<FacebookConversionApiCredentials> = {
    func: FacebookConversionsApi,
    configEnvVar: "TEST_FACEBOOK_CONVERSION_API_DESTINATION",
    events: [
      {
        type: "identify",
        userId: "cleviyagu0000zl13jld7acac",
        traits: {
          email: "john.doe@jitsu.com",
          name: "John Doe",
        },
        anonymousId: "4d8b1ca1-fbc7-445a-9cb0-41bfea348521",
        timestamp: "2023-11-26T00:50:25.999Z",
        sentAt: "2023-11-26T00:50:25.999Z",
        messageId: "2bssgfwgf751wyt10xb0mz",
        writeKey: "FDiExsmGYePJa651vnN7LyhMQYq972s1:***",
        groupId: "cl9sotck40002tt2b18i2x430",
        context: {
          library: {
            name: "@jitsu/js",
            version: "0.0.0",
          },
          page: {},
          clientIds: {},
          campaign: {},
          userAgent: "undici",
          locale: "*",
        },
        request_ip: "54.146.65.110",
        receivedAt: "2023-11-26T00:50:26.112Z",
      },
    ],
  };
  await testJitsuFunction(opts);
});
