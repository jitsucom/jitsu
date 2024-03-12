import { getLog } from "juava";
import { createServer, SimpleSyrup } from "./simple-syrup";
import { EnrichedConnectionConfig, FunctionConfig } from "../src/lib/config-types";
import { EntityStore } from "../src/lib/entity-store";
import { functionFilter, rotorMessageHandler } from "../src/lib/message-handler";
import { CONNECTION_IDS_HEADER } from "../src/lib/rotor";
import { createMemoryStore, DummyEventsStore } from "@jitsu/core-functions";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { isEqual } from "lodash";
import { functions, connections } from "./functions-chain-data";
import { expect, test, describe } from "@jest/globals";
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
  toJSON: () => "",
  enabled: true,
  lastModified: new Date(),
};

const connectionStore: EntityStore<EnrichedConnectionConfig> = {
  getObject: (id: string) => {
    return connections[id];
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
        lastError = new Error(`${testName}_${counter} unexpected request:\n${JSON.stringify(req.body, null, 2)}`);
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
    try {
      const res = await rotorMessageHandler(
        ingestMessage("simple", "message1", incomingEvent),
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        "all",
        { [CONNECTION_IDS_HEADER]: "simple" },
        true,
        0,
        5000
      );
      //log.atInfo().log("Result: ", JSON.stringify(res, null, 2));
    } catch (e: any) {
      if (e.message === "HTTP Error: 444 unknown") {
        expect(e.event).toEqual(expectedEvents.simple_0);
      }
      throw e;
    }
  });

  test("error", async () => {
    try {
      await rotorMessageHandler(
        ingestMessage("error", "message1", incomingEvent),
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        "all",
        { [CONNECTION_IDS_HEADER]: "error" },
        true,
        0,
        5000
      );
    } catch (e: any) {
      if (e.message === "HTTP Error: 444 unknown") {
        expect(e.event).toEqual(expectedEvents.error_0);
      }
      throw e;
    }
  });

  test("retry", async () => {
    const iMessage = ingestMessage("retry", "message1", incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        filter,
        { [CONNECTION_IDS_HEADER]: "retry" },
        true,
        0,
        5000
      );
    } catch (e: any) {
      expect(e.name).toEqual("RetryError");
      expect(e.message).toEqual("Function runs successfully only on 2nd attempt");
      expect(lastError).toBeUndefined();
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
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        filter,
        { [CONNECTION_IDS_HEADER]: "retry" },
        true,
        1,
        5000
      );
    } catch (e: any) {
      if (e.message === "HTTP Error: 444 unknown") {
        expect(e.event).toEqual(expectedEvents.retry_1);
      }
      throw e;
    }
  });

  test("drop_retry", async () => {
    const iMessage = ingestMessage("drop_retry", "message1", incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        filter,
        { [CONNECTION_IDS_HEADER]: "drop_retry" },
        true,
        0,
        5000
      );
      expect(res?.events).toHaveLength(0);
    } catch (e: any) {
      expect(e.name).toEqual("Drop & RetryError");
      expect(e.message).toEqual("Function runs successfully only on 2nd attempt");
      expect(lastError).toBeUndefined();
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
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        filter,
        { [CONNECTION_IDS_HEADER]: "drop_retry" },
        true,
        1,
        5000
      );
    } catch (e: any) {
      if (e.message === "HTTP Error: 444 unknown") {
        expect(e.event).toEqual(expectedEvents.drop_retry_0);
      }
      throw e;
    }
  });

  test("dst_retry", async () => {
    const iMessage = ingestMessage("dst_retry", "message1", incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        filter,
        { [CONNECTION_IDS_HEADER]: "dst_retry" },
        true,
        0,
        5000
      );
    } catch (e: any) {
      expect(e.name).toEqual("RetryError");
      expect(e.message).toEqual("HTTP Error: 444 unknown");
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
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        filter,
        { [CONNECTION_IDS_HEADER]: "dst_retry" },
        true,
        1,
        5000
      );
      //log.atInfo().log("Result: ", JSON.stringify(res, null, 2));
    } catch (e: any) {
      throw e;
    }
    expect(lastError).toBeUndefined();
  });

  test("multi", async () => {
    try {
      const res = await rotorMessageHandler(
        ingestMessage("multi", "message1", incomingEvent),
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        "all",
        { [CONNECTION_IDS_HEADER]: "multi" },
        true,
        0,
        5000
      );
      expect(res?.events).toHaveLength(2);
    } catch (e: any) {
      throw e;
    }
    expect(lastError).toBeUndefined();
  });

  test("multi_middle", async () => {
    try {
      const res = await rotorMessageHandler(
        ingestMessage("multi_middle", "message1", incomingEvent),
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        "all",
        { [CONNECTION_IDS_HEADER]: "multi_middle" },
        true,
        0,
        5000
      );
    } catch (e: any) {
      if (e.message === "HTTP Error: 444 unknown") {
        expect(e.event).toEqual(expectedEvents.multi_middle_0);
      }
      throw e;
    }
  });

  test("multi_retry", async () => {
    const iMessage = ingestMessage("multi_retry", "message1", incomingEvent);
    let filter: FuncChainFilter = "all";
    try {
      const res = await rotorMessageHandler(
        iMessage,
        {
          connectionStore: connectionStore,
          functionsStore: funcStore,
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        filter,
        { [CONNECTION_IDS_HEADER]: "multi_retry" },
        true,
        0,
        5000
      );
      expect(res?.events).toHaveLength(1);
    } catch (e: any) {
      expect(e.name).toEqual("RetryError");
      expect(e.message).toEqual("Function runs successfully only on 2nd attempt");
      expect(lastError).toBeUndefined();
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
          eventsLogger: DummyEventsStore,
          dummyPersistentStore: createMemoryStore({}),
        },
        filter,
        { [CONNECTION_IDS_HEADER]: "multi_retry" },
        true,
        1,
        5000
      );
      expect(res?.events).toHaveLength(2);
    } catch (e: any) {
      throw e;
    }
    expect(lastError).toBeUndefined();
  });
});
