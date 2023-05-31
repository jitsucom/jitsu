import { createServer, SimpleSyrup } from "../simple-syrup";
import { AnalyticsClientEvent, AnalyticsInterface } from "@jitsu/protocols/analytics";

const jitsuAnalytics = require("../../dist/jitsu.cjs.js").jitsuAnalytics;
const fetchImpl = require("node-fetch-commonjs");

describe("Test Jitsu NodeJS client", () => {
  let server: SimpleSyrup;

  let requestLog: { type: string; body: AnalyticsClientEvent }[] = [];

  const startServer = async () => {
    server = await createServer({
      port: 3088,
      https: false,
      handlers: {
        "/api/s/:type": (req, res) => {
          res.setHeader("Content-Type", "text/javascript");
          res.send({ ok: true });
          requestLog.push({
            type: req.params.type,
            body: req.body,
          });
        },
      },
    });
    console.log("Running on " + server.baseUrl);
  };
  const shutdownServer = async () => {
    console.log("Shutting down server " + server.baseUrl);
    await server.close();
  };

  test("node js", async () => {
    await startServer();
    try {
      const jitsu: AnalyticsInterface = jitsuAnalytics({
        writeKey: "key:secret",
        host: server.baseUrl,
        debug: true,
        fetch: fetchImpl,
      });
      await jitsu.track("testTrack");

      await jitsu.identify("testUser", {
        email: "test@test.com",
      });

      await jitsu.group("testGroup", {
        name: "Test Group",
      });

      await jitsu.page({
        name: "test",
        environment: "nodejs",
        context: {
          page: {
            url: "http://server.com",
          },
        },
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(requestLog.length).toBe(4);
      expect(requestLog[0].type).toBe("track");
      expect(requestLog[1].type).toBe("identify");
      expect(requestLog[2].type).toBe("group");
      expect(requestLog[3].type).toBe("page");

      const track = requestLog[0].body as AnalyticsClientEvent;
      const identify = requestLog[1].body as AnalyticsClientEvent;
      const group = requestLog[2].body as AnalyticsClientEvent;
      const page = requestLog[3].body as AnalyticsClientEvent;

      //expect(track.userId).toBe(undefined);
      expect(page.properties.name).toBe("test");
      expect(page.properties?.environment).toBe("nodejs");
      expect(page.context.page.url).toBe("http://server.com");
      expect(page.userId).toBe("testUser");
      expect(identify.traits.email).toBe("test@test.com");
      expect(identify.anonymousId).toBe(page.anonymousId);
      expect(group.traits.name).toBe("Test Group");
      expect(group.anonymousId).toBe(page.anonymousId);
      expect(group.userId).toBe("testUser");
      expect(group.groupId).toBe("testGroup");

      const pagePayload = requestLog[0].body;
      console.log("pagePayload", pagePayload);
    } finally {
      await shutdownServer();
    }
  });
});
