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
import { expect, test, describe, beforeAll, afterAll } from "vitest";
import { FuncChainFilter } from "../src/lib/functions-chain";

const log = getLog("functions-chain-test");

const incomingEvent = {
  type: "track",
  properties: {},
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
    context: {},
  },
  error_0: {
    type: "track",
    properties: {
      retries: 0,
      first: "1st",
      counter: 2,
      third: "3rd",
    },
    context: {},
  },
  retry_0: {
    type: "track",
    properties: {
      first: "1st",
      retries: 0,
      counter: 2,
      third: "3rd",
    },
    context: {},
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
    context: {},
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
    context: {},
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
    context: {},
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
    context: {},
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
    context: {},
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
    context: {},
  },
  multi_middle_0: {
    type: "track",
    properties: {
      first: "1st",
      retries: 0,
      counter: 2,
      second: "2nd",
    },
    context: {},
  },
  multi_retry_0: {
    type: "track",
    properties: {
      first: "1st",
      retries: 0,
      counter: 2,
      second: "2nd",
    },
    context: {},
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
    context: {},
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
    context: {},
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

function testName() {
  const currentTestName = expect.getState().currentTestName as string;
  return currentTestName.replace("Test Functions Chain > ", "").trim();
}

const messageId = "message1";

describe("Test Functions Chain", () => {
  let server: SimpleSyrup;
  let lastError: any;
  const counters: Record<string, number> = {};

  beforeAll(async () => {
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
        res.status(444).send({ ok: false });
      }
      counters[testName]++;
    };
    server = await createServer({
      port: 3089,
      https: false,
      handlers: {
        "/simple": handlerF("simple"),
        "/error": handlerF("error"),
        "/retry": handlerF("retry"),
        "/drop_retry": handlerF("drop_retry"),
        "/no_retry": handlerF("no_retry"),
        "/dst_retry": handlerF("dst_retry"),
        "/multi": handlerF("multi"),
        "/multi_middle": handlerF("multi_middle"),
        "/multi_retry": handlerF("multi_retry"),
      },
    });
    console.log("Running on " + server.baseUrl);
  });

  afterAll(async () => {
    console.log("Shutting down server " + server.baseUrl);
    await server.close();
    console.log("Server is down " + server.baseUrl);
  });

  test("simple", async () => {
    const currentTestName = testName();
    try {
      const res = await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        "all",
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        0,
        5000
      );
      //log.atInfo().log("Result: ", JSON.stringify(res, null, 2));
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
    } catch (e: any) {
      throw e;
    }
  });

  test("error", async () => {
    const currentTestName = testName();
    try {
      await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
      expect(lastError).toBeUndefined();
      expect(counters[currentTestName]).toEqual(1);
      filter = functionFilter(e.functionId);
      iMessage.httpPayload = e.event;
    }
    //retry
    try {
      await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    try {
      const res = await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        filter,
        { [CONNECTION_IDS_HEADER]: currentTestName },
        true,
        1,
        5000
      );
      //log.atInfo().log("Result: ", JSON.stringify(res, null, 2));
      expect(counters[currentTestName]).toEqual(2);
      expect(lastError).toBeUndefined();
    } catch (e: any) {
      throw e;
    }
  });

  test("multi", async () => {
    const currentTestName = testName();
    try {
      const res = await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
    try {
      const res = await rotorMessageHandler(
        ingestMessage(currentTestName, messageId, incomingEvent),
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
    const iMessage = ingestMessage(currentTestName, messageId, incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          streamsStore: streamsStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
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
});
