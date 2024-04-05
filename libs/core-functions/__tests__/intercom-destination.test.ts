import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { IntercomDestinationCredentials } from "../src/meta";
import IntercomDestination from "../src/functions/intercom-destination";
import { setGlobalLogLevel, setServerLogColoring } from "juava";

setServerLogColoring(true);
setGlobalLogLevel("debug");

test("test", async () => {
  if (!process.env.TEST_INTERCOM_DESTINATION_CONFIG) {
    console.log("TEST_INTERCOM_DESTINATION_CONFIG is not set, skipping test");
    return;
  }
  const email = "dwight.schrute@dunder-mifflin.com";
  const userId = "user-id-ds";

  const workspaceId = "workspace-id-dm";
  const workspaceName = "Dunder Mifflin";
  const workspaceSlug = "dunder-mifflin";
  const name = "Dwight Schrute";

  let opts: TestOptions<IntercomDestinationCredentials>;
  opts = {
    funcWrapper: IntercomDestination,
    configEnvVar: "TEST_INTERCOM_DESTINATION_CONFIG",
    events: [
      {
        type: "identify",
        userId: userId,
        traits: { email, name },
        timestamp: "2023-11-28T20:37:14.693Z",
        sentAt: "2023-11-28T20:37:14.693Z",
        messageId: "7qfgopt6mo22xk2tqs0tb",
        groupId: workspaceId,
        context: {},
        receivedAt: "2023-11-28T20:37:14.799Z",
      },
      {
        type: "track",
        event: "user_created",
        properties: {},
        userId: userId,
        timestamp: "2023-11-29T16:55:50.255Z",
        sentAt: "2023-11-29T16:55:50.255Z",
        messageId: "22ccyzg8enx2duj3bcit8h",
        writeKey: "FDiExsmGYePJa651vnN7LyhMQYq972s1:***",
        context: {
          traits: { email, name, externalId: `ext-${userId}` },
          page: {},
          clientIds: {},
          campaign: {},
        },
      },
      {
        type: "group",
        groupId: workspaceId,
        traits: { workspaceSlug, workspaceName, workspaceId, name: workspaceName },
        timestamp: "2023-11-28T20:37:14.673Z",
        sentAt: "2023-11-28T20:37:14.673Z",
        messageId: "1xdx6pryjnuqgi4jz362j",
        context: {},
        receivedAt: "2023-11-28T20:37:14.798Z",
      },
      {
        type: "track",
        event: "workspace_created",
        properties: {},
        userId,
        timestamp: "2023-11-29T19:02:36.535Z",
        sentAt: "2023-11-29T19:02:36.535Z",
        messageId: "223drh0xi901pujmvl2kds",
        writeKey: "FDiExsmGYePJa651vnN7LyhMQYq972s1:***",
        groupId: "clpk4wd6n0000l90fmzoahn63",
        context: {
          traits: {
            workspaceName,
            workspaceId,
            email,
            name,
            externalId: `ext-${userId}`,
          },
          page: {},
          clientIds: {},
          campaign: {},
        },
        receivedAt: "2023-11-29T19:02:36.643Z",
      },
      {
        type: "page",
        userId,
        groupId: workspaceId,
        timestamp: "2023-11-29T19:02:36.152Z",
        messageId: "1m6c2acu28b1bt4eak2qk1",
        context: {
          traits: {
            email,
            name,
            externalId: `ext-${userId}`,
          },
          page: {
            title: "Jitsu",
            url: "https://use.jitsu.com/",
            path: `/${workspaceSlug}`,
          },
        },
      },
      {
        type: "track",
        event: "workspace_access",
        properties: { workspaceSlug, workspaceName, workspaceId },
        userId,
        anonymousId: "7c3f1bac-2e04-4ebf-8d34-95d56fb126ac",
        timestamp: "2023-11-28T20:36:42.201Z",
        sentAt: "2023-11-28T20:36:42.201Z",
        messageId: "24zebq8rj3414ubowikeup",
        groupId: workspaceId,
        context: {
          library: {
            name: "@jitsu/js",
            version: "0.0.0",
          },
          traits: { workspaceSlug, workspaceName, workspaceId, email, name },
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
