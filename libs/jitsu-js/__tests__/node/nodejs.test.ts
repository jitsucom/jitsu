import { createServer, SimpleSyrup } from "../simple-syrup";
import { AnalyticsClientEvent, AnalyticsInterface } from "@jitsu/protocols/analytics";
import { getTopLevelDomain } from "../../src/tlds";

const jitsuAnalytics = require("../../dist/jitsu.cjs.js").jitsuAnalytics;
const fetchImpl = require("node-fetch-commonjs");

describe("Test Jitsu NodeJS client", () => {
  let server: SimpleSyrup;

  let requestLog: { type: string; body: AnalyticsClientEvent }[] = [];

  const startServer = async () => {
    requestLog = [];
    let handler = (req, res) => {
      res.setHeader("Content-Type", "text/javascript");
      res.send({ ok: true });
      requestLog.push({
        type: req.params.type,
        body: req.body,
      });
    };
    server = await createServer({
      port: 3088,
      https: false,
      handlers: {
        //we're using same handler for s2s and browser events since
        //we don't check types anyway
        "/api/s/:type": handler,
        "/api/s/s2s/:type": handler,
      },
    });
    console.log("Running on " + server.baseUrl);
  };
  const shutdownServer = async () => {
    console.log("Shutting down server " + server.baseUrl);
    await server.close();
    console.log("Server is down " + server.baseUrl);
  };

  beforeAll(async () => {
    await startServer();
  });

  beforeEach(() => {
    requestLog = [];
  });

  afterAll(async () => {
    await shutdownServer();
  });

  test("setAnonymousId test2", async () => {
    const config = {
      host: server.baseUrl,
      writeKey: "key:secret",
      debug: true,
    };

    console.log("[JITSU TEST] Initializing Jitsu");
    const client = jitsuAnalytics(config);
    console.log("[JITSU TEST] Jitsu instance", client);

    const anonymousId = "anonymous_id_test";
    console.log("[JITSU TEST] Setting anonymous id to " + anonymousId);
    await client.setAnonymousId(anonymousId);
    console.log("user state", client.getState("user"));

    expect(requestLog.length).toBe(0);
    console.log("[JITSU TEST] Sending event EVENT_1");
    await client.track("EVENT_1");
    await client.track("EVENT_2");
    await client.track("groupId");

    await new Promise(resolve => setTimeout(resolve, 1000));

    expect(requestLog.length).toBe(3);
    expect(requestLog[1].body.anonymousId).toBe("anonymous_id_test");
    expect(requestLog[0].body.anonymousId).toBe("anonymous_id_test");
    expect(requestLog[2].body.anonymousId).toBe("anonymous_id_test");
  });

  test("test privacy dontSend", async () => {
    const config = {
      host: server.baseUrl,
      writeKey: "key:secret",
      debug: true,
      privacy: {
        dontSend: true,
      },
    };
    const client = jitsuAnalytics(config);
    expect(requestLog.length).toBe(0);
    await client.identify("myUserId", { email: "myUserId@example.com" });
    await client.group("myGroupId", { name: "myGroupId" });
    await client.track("myEvent", { prop1: "value1" });
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(requestLog.length).toBe(0);
  });

  test("test privacy dontSend then consent", async () => {
    const config = {
      host: server.baseUrl,
      writeKey: "key:secret",
      debug: true,
      privacy: {
        dontSend: true,
      },
    };
    const client = jitsuAnalytics(config);
    expect(requestLog.length).toBe(0);
    await client.identify("myUserId", { email: "myUserId@example.com" });
    await client.group("myGroupId", { name: "myGroupId" });
    await client.track("myEvent", { prop1: "value1" });
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(requestLog.length).toBe(0);

    client.configure({
      privacy: {
        dontSend: false,
        consentCategories: {
          analytics: true,
        },
      },
    });
    await client.identify("myUserId", { email: "myUserId@example.com" });
    await client.group("myGroupId", { name: "myGroupId" });
    await client.track("myEvent", { prop1: "value1" });
    await new Promise(resolve => setTimeout(resolve, 1000));

    expect(requestLog.length).toBe(3);
    const p = requestLog[2];
    expect(p.type).toEqual("track");
    expect(p.body.event).toBe("myEvent");
    expect(p.body.userId).toEqual("myUserId");
    expect(p.body.groupId).toEqual("myGroupId");
    expect(p.body.context?.traits?.email).toEqual("myUserId@example.com");
    expect(p.body.context?.consent?.categoryPreferences).toEqual({ analytics: true });
    expect((p.body.anonymousId ?? "").length).toBeGreaterThan(0);
  });

  test("test privacy disableUserIds", async () => {
    const config = {
      host: server.baseUrl,
      writeKey: "key:secret",
      debug: true,
      privacy: {
        disableUserIds: true,
      },
    };
    const client = jitsuAnalytics(config);
    expect(requestLog.length).toBe(0);
    await client.identify("myUserId", { email: "myUserId@example.com" });
    await client.group("myGroupId", { name: "myGroupId" });
    await client.track("myEvent", { prop1: "value1" });
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(requestLog.length).toBe(1);
    const p = requestLog[0];
    expect(p.type).toEqual("track");
    expect(p.body.event).toBe("myEvent");
    expect(p.body.userId).toBeUndefined();
    expect(p.body.groupId).toBeUndefined();
    expect(p.body.context?.traits?.email).toBeUndefined();
    expect(p.body.anonymousId).toBeUndefined();
    expect(p.body.properties?.prop1).toBe("value1");
  });

  test("test privacy disableUserIds then consent", async () => {
    const config = {
      host: server.baseUrl,
      writeKey: "key:secret",
      debug: true,
      privacy: {
        disableUserIds: true,
      },
    };
    const client = jitsuAnalytics(config);
    expect(requestLog.length).toBe(0);
    await client.identify("myUserId", { email: "myUserId@example.com" });
    await client.group("myGroupId", { name: "myGroupId" });
    await client.track("myEvent", { prop1: "value1" });
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(requestLog.length).toBe(1);
    let p = requestLog[0];
    expect(p.type).toEqual("track");
    expect(p.body.event).toBe("myEvent");
    expect(p.body.userId).toBeUndefined();
    expect(p.body.groupId).toBeUndefined();
    expect(p.body.context?.traits?.email).toBeUndefined();
    expect(p.body.anonymousId).toBeUndefined();
    expect(p.body.properties?.prop1).toBe("value1");

    client.configure({
      privacy: {
        disableUserIds: false,
        consentCategories: {
          analytics: true,
        },
      },
    });
    await client.identify("myUserId", { email: "myUserId@example.com" });
    await client.group("myGroupId", { name: "myGroupId" });
    await client.track("myEvent", { prop1: "value1" });
    await new Promise(resolve => setTimeout(resolve, 1000));

    expect(requestLog.length).toBe(4);
    p = requestLog[3];
    expect(p.type).toEqual("track");
    expect(p.body.event).toBe("myEvent");
    expect(p.body.userId).toEqual("myUserId");
    expect(p.body.groupId).toEqual("myGroupId");
    expect(p.body.context?.traits?.email).toEqual("myUserId@example.com");
    expect(p.body.context?.consent?.categoryPreferences).toEqual({ analytics: true });
    expect((p.body.anonymousId ?? "").length).toBeGreaterThan(0);
  });

  test("node js", async () => {
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
  });

  test("tld", async () => {
    expect(getTopLevelDomain("www.google.com")).toBe("google.com");
    expect(getTopLevelDomain("www.trendstyle.com.au")).toBe("trendstyle.com.au");
    expect(getTopLevelDomain("localhost:3000")).toBe("localhost");
    expect(getTopLevelDomain("use.jitsu.com")).toBe("jitsu.com");
    expect(getTopLevelDomain("use.jitsu.com")).toBe("jitsu.com");
    //console.log(parse("http://localhost:3000"));
  });
});
