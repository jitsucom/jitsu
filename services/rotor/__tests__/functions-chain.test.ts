import { getLog } from "juava";
import { createServer, SimpleSyrup } from "./simple-syrup";
import { functionFilter, rotorMessageHandler } from "../src/lib/message-handler";
import { CONNECTION_IDS_HEADER } from "../src/lib/rotor";
import {
  createMemoryStore,
  DummyEventsStore,
  EnrichedConnectionConfig,
  EntityStore,
  FunctionConfig,
  StreamWithDestinations,
} from "@jitsu/destination-functions";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { isEqual } from "lodash";
import { functions, connections } from "./functions-chain-data";
import { expect, test, describe, beforeAll, afterAll, beforeEach } from "vitest";
import { FuncChainFilter } from "../src/lib/functions-chain";
import {
  writeTestConfigs,
  startTestFunctionsServer,
  cleanupTestConfigs,
  TestFunctionsServer,
} from "./functions-server-helper";
import { resetServerEnvCache } from "../src/serverEnv";
// @ts-ignore
import path from "path";
// @ts-ignore
import os from "os";
import { Geo } from "@jitsu/protocols/analytics";

const log = getLog("functions-chain-test");

const context = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 16; SM-S931B Build/BP2A.250605.031.A3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.59 Mobile Safari/537.36",
};

const staticGeo: Geo = {
  country: {
    code: "US",
    name: "United States",
    isEU: false,
  },
  continent: {
    code: "NA",
    name: "North America",
  },
  region: {
    code: "CA",
    name: "California",
  },
  city: {
    name: "San Francisco",
  },
  location: {
    latitude: 47.6109,
    longitude: -122.3303,
    timezone: "America/Los_Angeles",
    accuracyRadius: 1000,
    usaData: {},
  },
  provider: {
    as: { num: 8075, name: "Microsoft Corporation" },
    isp: "Microsoft Azure",
    domain: "msn.com",
  },
};

const incomingEvent = {
  type: "track",
  properties: {},
  context,
};

const expectedEvents = {
  simple_0: {
    type: "track",
    properties: {
      retries: 0,
      first: "1st",
      counter: 3,
      second: "2nd",
      third: "3rd",
    },
    context,
  },
  env_0: {
    type: "track",
    properties: {
      retries: 0,
      first: "1st-from-env",
      counter: 3,
      second: "2nd",
      third: "3rd",
    },
    context,
  },
  noreturn_0: {
    type: "track",
    properties: {
      counter: 2,
      second: "2nd",
      third: "3rd",
    },
    context,
  },
  error_0: {
    type: "track",
    properties: {
      retries: 0,
      first: "1st",
      counter: 2,
      third: "3rd",
    },
    context,
  },
  retry_0: {
    type: "track",
    properties: {
      first: "1st",
      retries: 0,
      counter: 2,
      third: "3rd",
    },
    context,
  },
  retry_1: {
    type: "track",
    properties: {
      retries: 1,
      first: "1st",
      counter: 3,
      second: "2nd",
      third: "3rd",
    },
    context,
  },
  drop_retry_0: {
    type: "track",
    properties: {
      retries: 1,
      first: "1st",
      counter: 3,
      second: "2nd",
      third: "3rd",
    },
    context,
  },
  dst_retry_0: {
    type: "INTENTIONALY_INCORRECT",
    properties: {
      retries: 0,
      first: "1st",
      counter: 3,
      second: "2nd",
      third: "3rd",
    },
    context,
  },
  dst_retry_1: {
    type: "track",
    properties: {
      // that is set by functions. but udf step is skipped for destination retries
      retries: 0,
      first: "1st",
      counter: 3,
      second: "2nd",
      third: "3rd",
    },
    context,
  },
  multi_0: {
    n: 1,
    type: "track",
    properties: {
      first: "1st",
      retries: 0,
      counter: 2,
      second: "2nd",
    },
    context,
  },
  multi_1: {
    n: 2,
    type: "track",
    properties: {
      first: "1st",
      retries: 0,
      counter: 2,
      second: "2nd",
    },
    context,
  },
  multi_middle_0: {
    type: "track",
    properties: {
      first: "1st",
      retries: 0,
      counter: 2,
      second: "2nd",
    },
    context,
  },
  multi_retry_0: {
    type: "track",
    properties: {
      first: "1st",
      retries: 0,
      counter: 2,
      second: "2nd",
    },
    context,
  },
  multi_retry_1: {
    n: 1,
    type: "track",
    properties: {
      first: "1st",
      retries: 1,
      counter: 2,
      second: "2nd",
    },
    context,
  },
  multi_retry_2: {
    n: 2,
    type: "track",
    properties: {
      first: "1st",
      retries: 1,
      counter: 2,
      second: "2nd",
    },
    context,
  },
  ua_geo_0: {
    type: "track",
    properties: {
      geo: staticGeo,
      ua: {
        browser: {
          name: "Chrome",
          version: "144.0.7559.59",
          major: "144",
        },
        engine: {
          name: "Blink",
          version: "144.0.7559.59",
        },
        os: {
          name: "Android",
          version: "16",
        },
        device: {
          vendor: "Samsung",
          model: "SM-S931B",
          type: "mobile",
        },
        cpu: {},
        bot: false,
      },
    },
    context: {
      ...context,
      ip: "165.165.165.165",
      geo: staticGeo,
    },
  },
};

const funcStore: EntityStore<FunctionConfig> = {
  getObject: (id: string) => {
    return functions[id];
  },
  getAll: () => {
    return functions as unknown as Record<string, FunctionConfig>;
  },
  toJSON: () => "",
  enabled: true,
  lastModified: new Date(),
};

const connectionStore: EntityStore<EnrichedConnectionConfig> = {
  getObject: (id: string) => {
    return connections[id];
  },
  getAll: () => {
    return connections as unknown as Record<string, EnrichedConnectionConfig>;
  },
  toJSON: () => "",
  enabled: true,
  lastModified: new Date(),
};

const streamsStore: EntityStore<StreamWithDestinations> = {
  getObject: (id: string) => {
    return undefined;
  },
  getAll: () => {
    return {} as Record<string, StreamWithDestinations>;
  },
  toJSON: () => "",
  enabled: true,
  lastModified: new Date(),
};

function rotorContext(
  connStore: EntityStore<EnrichedConnectionConfig>,
  funcStore: EntityStore<FunctionConfig>,
  streamsStore: EntityStore<StreamWithDestinations>
) {
  return {
    connectionStore: connStore,
    functionsStore: funcStore,
    streamsStore: streamsStore,
    eventsLogger: DummyEventsStore,
    dummyPersistentStore: createMemoryStore({}),
    geoResolver: {
      resolve: async (ip: string): Promise<Geo> => {
        return staticGeo;
      },
    },
  };
}

function ingestMessage(connectionId: string, messageId: string, event: any): IngestMessage {
  return {
    type: "track",
    ingestType: "browser",
    messageId,
    connectionId,
    httpPayload: event,
    httpHeaders: {},
    origin: {
      baseUrl: "example.com",
    },
    writeKey: "",
    messageCreated: new Date().toISOString(),
  };
}

const messageId = "message1";

// Test modes to run
const testModes: Array<{ name: string; functionsClass: string }> = [
  { name: "legacy", functionsClass: "legacy" },
  { name: "free", functionsClass: "free" },
  { name: "dedicated", functionsClass: "dedicated" },
];

describe.each(testModes)("Test Functions Chain ($name mode)", ({ name: modeName, functionsClass }) => {
  let webhookServer: SimpleSyrup;
  let functionsServer: TestFunctionsServer | null = null;
  let lastError: any;
  const counters: Record<string, number> = {};
  let originalEnv: string | undefined;
  const webhookServerPort = 3089 + (functionsClass === "free" ? 100 : functionsClass === "dedicated" ? 200 : 0);

  function testName() {
    const currentTestName = expect.getState().currentTestName as string;
    // Extract just the test name, removing the describe block prefix
    const match = currentTestName.match(/> ([^>]+)$/);
    return match ? match[1].trim() : currentTestName;
  }

  beforeAll(async () => {
    // Save original env
    originalEnv = process.env.FUNCTIONS_SERVER_URL_TEMPLATE;

    // Set up functions server for "free" mode
    if (functionsClass === "free" || functionsClass === "dedicated") {
      const configDir = path.join(os.tmpdir(), `rotor-test-${Date.now()}`);

      // Write test configs
      await writeTestConfigs(
        configDir,
        connections as unknown as Record<string, EnrichedConnectionConfig>,
        functions as unknown as Record<string, FunctionConfig>
      );

      process.env.FUNCTIONS_CLASS = functionsClass;

      // Start functions server
      const fsPort = 3457 + Math.floor(Math.random() * 100);
      functionsServer = await startTestFunctionsServer(configDir, fsPort);

      // Configure rotor to use the test functions server
      process.env.FUNCTIONS_SERVER_URL_TEMPLATE = `http://localhost:${fsPort}`;
      // Reset cache so new env value is picked up
      resetServerEnvCache();
    }

    // Set up webhook server for all tests
    let handlerF = (testName: string) => (req, res) => {
      lastError = undefined;
      if (!counters[testName]) {
        counters[testName] = 0;
      }
      const counter = counters[testName];
      log.atInfo().log(
        `[${testName}] received ${counter} request:
`,
        JSON.stringify(req.body, null, 2)
      );
      res.setHeader("Content-Type", "application/json");
      if (isEqual(req.body, expectedEvents[`${testName}_${counter}`])) {
        res.send({ ok: true });
      } else {
        lastError = new Error(
          `${testName}_${counter} unexpected webhook request:\n${JSON.stringify(req.body, null, 2)}`
        );
        res
          .status(444)
          .send({ ok: false, reason: `unexpected webhook request:\n${JSON.stringify(req.body, null, 2)}` });
      }
      counters[testName]++;
    };

    webhookServer = await createServer({
      port: webhookServerPort,
      https: false,
      handlers: {
        "/simple": handlerF("simple"),
        "/env": handlerF("env"),
        "/noreturn": handlerF("noreturn"),
        "/error": handlerF("error"),
        "/retry": handlerF("retry"),
        "/drop_retry": handlerF("drop_retry"),
        "/no_retry": handlerF("no_retry"),
        "/dst_retry": handlerF("dst_retry"),
        "/multi": handlerF("multi"),
        "/multi_middle": handlerF("multi_middle"),
        "/multi_retry": handlerF("multi_retry"),
        "/ua_geo": handlerF("ua_geo"),
      },
    });
    console.log(`[${modeName}] Webhook server running on ${webhookServer.baseUrl}`);
  }, 90000); // Increase timeout to 90s for functions server startup (ts-node compilation is slow)

  afterAll(async () => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.FUNCTIONS_SERVER_URL_TEMPLATE = originalEnv;
    } else {
      delete process.env.FUNCTIONS_SERVER_URL_TEMPLATE;
    }
    delete process.env.FUNCTIONS_CLASS;
    // Reset cache so original env value is restored
    resetServerEnvCache();

    // Stop functions server if running
    if (functionsServer) {
      await functionsServer.close();
      cleanupTestConfigs(functionsServer.configDir);
    }

    // Stop webhook server
    console.log(`[${modeName}] Shutting down webhook server`);
    await webhookServer?.close();
    console.log(`[${modeName}] Servers stopped`);
  }, 30000); // Increase timeout to 30s for cleanup

  beforeEach(() => {
    // Reset counters and errors for each test
    lastError = undefined;
  });

  // Update connection URLs to use the correct webhook server port and add functionsClasses
  function getConnectionStoreForMode(): EntityStore<EnrichedConnectionConfig> {
    return {
      getObject: (id: string) => {
        const conn = connections[id];
        if (!conn) return undefined;
        // Update the URL to use the correct port and add functionsClasses to options
        return {
          ...conn,
          credentials: {
            ...conn.credentials,
            url: conn.credentials.url.replace(":3089", `:${webhookServerPort}`),
          },
          options: {
            ...conn.options,
            functionsClasses: [functionsClass],
          },
          // we need to prevent usage of cached functions chain
          updatedAt: new Date(),
        } as EnrichedConnectionConfig;
      },
      getAll: () => {
        const result: Record<string, EnrichedConnectionConfig> = {};
        for (const [id, conn] of Object.entries(connections)) {
          result[id] = {
            ...conn,
            credentials: {
              ...conn.credentials,
              url: conn.credentials.url.replace(":3089", `:${webhookServerPort}`),
            },
            options: {
              ...conn.options,
              functionsClasses: [functionsClass],
            },
            // we need to prevent usage of cached functions chain
            updatedAt: new Date(),
          } as unknown as EnrichedConnectionConfig;
        }
        return result;
      },
      toJSON: () => "",
      enabled: true,
      lastModified: new Date(),
    };
  }

  test("simple", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    try {
      const res = await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        rotorContext(connStore, funcStore, streamsStore),
        "all",
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
    } catch (e: any) {
      throw e;
    }
  });

  test("env", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    try {
      const res = await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        rotorContext(connStore, funcStore, streamsStore),
        "all",
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
    } catch (e: any) {
      throw e;
    }
  });

  test("noreturn", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    try {
      const res = await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        rotorContext(connStore, funcStore, streamsStore),
        "all",
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
    } catch (e: any) {
      throw e;
    }
  });

  test("error", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    try {
      await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        rotorContext(connStore, funcStore, streamsStore),
        "all",
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
    } catch (e: any) {
      throw e;
    }
  });

  test("retry", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        rotorContext(connStore, funcStore, streamsStore),
        filter,
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      // Should not reach here - RetryError should be thrown
      expect(res).toEqual("unexpected success");
    } catch (e: any) {
      expect(e.name).toEqual("RetryError");
      expect(e.message).toEqual("Function runs successfully only on 2nd attempt");
      expect(e.retryPolicy).toEqual({ attempts: 2, delays: [60, 1440] });
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
      filter = functionFilter(e.functionId);
      iMessage.httpPayload = e.event;
    }
    //retry
    try {
      await rotorMessageHandler(
        iMessage,
        rotorContext(connStore, funcStore, streamsStore),
        filter,
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        1,
        5000
      );
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(2);
    } catch (e: any) {
      throw e;
    }
  });

  test("drop_retry", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        rotorContext(connStore, funcStore, streamsStore),
        filter,
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      // Should not reach here - RetryError should be thrown
      expect(res).toEqual("unexpected success");
    } catch (e: any) {
      expect(e.name).toEqual("Drop & RetryError");
      expect(e.message).toEqual("Function runs successfully only on 2nd attempt");
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toBeUndefined();
      filter = functionFilter(e.functionId);
      iMessage.httpPayload = e.event;
    }
    //retry
    try {
      await rotorMessageHandler(
        iMessage,
        rotorContext(connStore, funcStore, streamsStore),
        filter,
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        1,
        5000
      );
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
    } catch (e: any) {
      throw e;
    }
  });

  test("no_retry", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    try {
      const res = await rotorMessageHandler(
        iMessage,
        rotorContext(connStore, funcStore, streamsStore),
        "all",
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      // Should not reach here - NoRetryError should be thrown
      expect(res).toEqual("unexpected success");
    } catch (e: any) {
      // Verify NoRetryError was thrown
      expect(e.name).toEqual("NoRetryError");
      expect(e.message).toEqual("Invalid data format - permanent failure");

      const event = e.event;

      // Verify that all UDF chain changes are dropped
      expect(event.properties.first).toBeUndefined();
      expect(event.properties.second).toBeUndefined();
      expect(event.properties.counter).toBeUndefined();
      expect(event.properties.third).toBeUndefined(); // function3 should not have run

      // Verify no webhook was called (event didn't reach destination)
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toBeUndefined();
    }
  });

  test("dst_retry", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        rotorContext(connStore, funcStore, streamsStore),
        filter,
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      // Should not reach here - RetryError should be thrown
      expect(res).toEqual("unexpected success");
    } catch (e: any) {
      expect(e.name).toEqual("RetryError");
      expect(e.message).toEqual("HTTP Error: 444 unknown");
      expect(counters[currentTestName]).toEqual(1);
      expect(lastError).toBeDefined();
      expect(lastError.message).toContain("dst_retry_0 unexpected webhook request");
      filter = functionFilter(e.functionId);
      iMessage.httpPayload = e.event;
    }
    //retry
    try {
      const res = await rotorMessageHandler(
        iMessage,
        rotorContext(connStore, funcStore, streamsStore),
        filter,
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        1,
        5000
      );
      expect(counters[currentTestName]).toEqual(2);
      expect(lastError).toBeUndefined();
    } catch (e: any) {
      throw e;
    }
  });

  test("multi", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    try {
      const res = await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        rotorContext(connStore, funcStore, streamsStore),
        "all",
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      expect(res?.events).toHaveLength(2);
      expect(counters[currentTestName]).toEqual(2);
      expect(lastError).toBeUndefined();
    } catch (e: any) {
      throw e;
    }
  });

  test("multi_middle", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    try {
      const res = await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        rotorContext(connStore, funcStore, streamsStore),
        "all",
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      // Should not reach here - RetryError should be thrown
      expect(res).toEqual("unexpected success");
    } catch (e: any) {
      expect(e.name).toEqual("NoRetryError");
      expect(e.message).toEqual(
        "Got 2 events as result of function #2 of 3. Only the last function in a chain is allowed to multiply events."
      );

      const event = e.event;

      // Verify that all UDF chain changes are dropped
      expect(event.properties.first).toBeUndefined();
      expect(event.properties.second).toBeUndefined();
      expect(event.properties.counter).toBeUndefined();
      expect(event.properties.third).toBeUndefined(); // function3 should not have run

      // Verify no webhook was called (event didn't reach destination)
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toBeUndefined();
    }
  });

  test("multi_retry", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        rotorContext(connStore, funcStore, streamsStore),
        filter,
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      expect(res?.events).toHaveLength(1);
    } catch (e: any) {
      expect(e.name).toEqual("RetryError");
      expect(e.message).toEqual("Function runs successfully only on 2nd attempt");
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
      filter = functionFilter(e.functionId);
      iMessage.httpPayload = e.event;
    }
    //retry
    try {
      const res = await rotorMessageHandler(
        iMessage,
        rotorContext(connStore, funcStore, streamsStore),
        filter,
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        1,
        5000
      );
      expect(res?.events).toHaveLength(2);
      expect(counters[currentTestName]).toEqual(3);
      expect(lastError).toBeUndefined();
    } catch (e: any) {
      throw e;
    }
  });

  test("ua_geo", async () => {
    const currentTestName = testName();
    const connStore = getConnectionStoreForMode();
    const event = {
      ...incomingEvent,
      context: {
        ...incomingEvent.context,
        ip: "165.165.165.165",
      },
    };
    try {
      const res = await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, event),
        rotorContext(connStore, funcStore, streamsStore),
        "all",
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
    } catch (e: any) {
      throw e;
    }
  });
});
