import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { IntercomDestinationCredentials } from "../src/meta";
import IntercomDestination from "../src/functions/intercom-destination";

test("test", async () => {
  if (!process.env.TEST_INTERCOM_DESTINATION_CONFIG) {
    console.log("TEST_INTERCOM_DESTINATION_CONFIG is not set, skipping test");
    return;
  }
  const opts: TestOptions<IntercomDestinationCredentials> = {
    func: IntercomDestination,
    configEnvVar: "TEST_INTERCOM_DESTINATION_CONFIG",
    events: [
      {
        type: "identify",
        userId: "cleviyagu0000zl13jld7acac",
        traits: {
          email: "vladimir@jitsu.com",
          name: "Vladimir Klimontovich",
        },
        timestamp: "2023-11-28T20:37:14.693Z",
        sentAt: "2023-11-28T20:37:14.693Z",
        messageId: "7qfgopt6mo22xk2tqs0tb",
        groupId: "cl9sotck40002tt2b18i2x430",
        context: {},
        receivedAt: "2023-11-28T20:37:14.799Z",
      },
      {
        type: "group",
        groupId: "cl9sotck40002tt2b18i2x430",
        traits: {
          workspaceSlug: "jitsu",
          workspaceName: "Jitsu Playground",
          workspaceId: "cl9sotck40002tt2b18i2x430",
        },
        timestamp: "2023-11-28T20:37:14.673Z",
        sentAt: "2023-11-28T20:37:14.673Z",
        messageId: "1xdx6pryjnuqgi4jz362j",
        context: {},
        receivedAt: "2023-11-28T20:37:14.798Z",
      },
      {
        type: "track",
        event: "workspace_access",
        properties: {
          workspaceSlug: "jitsu",
          workspaceName: "Jitsu Playground",
          workspaceId: "cl9sotck40002tt2b18i2x430",
        },
        userId: "cleviyagu0000zl13jld7acac",
        anonymousId: "7c3f1bac-2e04-4ebf-8d34-95d56fb126ac",
        timestamp: "2023-11-28T20:36:42.201Z",
        sentAt: "2023-11-28T20:36:42.201Z",
        messageId: "24zebq8rj3414ubowikeup",
        groupId: "cl9sotck40002tt2b18i2x430",
        context: {
          library: {
            name: "@jitsu/js",
            version: "0.0.0",
          },
          traits: {
            workspaceSlug: "jitsu",
            workspaceName: "Jitsu Playground",
            workspaceId: "cl9sotck40002tt2b18i2x430",
            email: "vladimir@jitsu.com",
            name: "Vladimir Klimontovich",
          },
          page: {},
          clientIds: {},
          campaign: {},
          userAgent: "undici",
          locale: "*",
        },
        receivedAt: "2023-11-28T20:36:42.255Z",
      },
    ],
  };
  await testJitsuFunction(opts);
});
