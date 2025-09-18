import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import UserRecognitionFunction from "../src/functions/user-recognition";
import { prefixLogMessage, testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { createAnonymousEventsStore, createStore, EventsByAnonId } from "./lib/mem-store";
import nodeFetch from "node-fetch-commonjs";
import { FunctionContext } from "../src";
import { InternalFetchType } from "../src/functions/lib";

const anonymousEvents: AnalyticsServerEvent[] = [
  {
    messageId: "1",
    type: "page",
    anonymousId: "anon1",
    context: {},
  },
  {
    messageId: "2",
    type: "page",
    anonymousId: "anon1",
    context: {},
  },
  {
    messageId: "3",
    type: "page",
    anonymousId: "anon1",
    context: {},
  },
];

const identifiedEvent: AnalyticsServerEvent = {
  messageId: "4",
  type: "identify",
  anonymousId: "anon1",
  userId: "user1",
  traits: {
    email: "test@example.com",
    name: "Test User",
  },
  context: {},
};

const identifiedEventEmailOnly: AnalyticsServerEvent = {
  messageId: "4",
  type: "identify",
  anonymousId: "anon1",
  userId: "",
  traits: {
    email: "test@example.com",
    name: "Test User",
  },
  context: {},
};

const expectedEvents: AnalyticsServerEvent[] = [
  {
    messageId: "4",
    type: "identify",
    anonymousId: "anon1",
    userId: "user1",
    traits: {
      email: "test@example.com",
      name: "Test User",
    },
    context: {},
  },
  {
    messageId: "1",
    _JITSU_UR_MESSAGE_ID: "4",
    type: "page",
    anonymousId: "anon1",
    userId: "user1",
    context: {
      traits: {
        email: "test@example.com",
        name: "Test User",
      },
    },
  },
  {
    messageId: "2",
    _JITSU_UR_MESSAGE_ID: "4",
    type: "page",
    anonymousId: "anon1",
    userId: "user1",
    context: {
      traits: {
        email: "test@example.com",
        name: "Test User",
      },
    },
  },
  {
    messageId: "3",
    _JITSU_UR_MESSAGE_ID: "4",
    type: "page",
    anonymousId: "anon1",
    userId: "user1",
    context: {
      traits: {
        email: "test@example.com",
        name: "Test User",
      },
    },
  },
];

const expectedEventsEmailOnly: AnalyticsServerEvent[] = [
  {
    messageId: "4",
    type: "identify",
    anonymousId: "anon1",
    userId: "",
    traits: {
      email: "test@example.com",
      name: "Test User",
    },
    context: {},
  },
  {
    messageId: "1",
    _JITSU_UR_MESSAGE_ID: "4",
    type: "page",
    anonymousId: "anon1",
    userId: "",
    context: {
      traits: {
        email: "test@example.com",
        name: "Test User",
      },
    },
  },
  {
    messageId: "2",
    _JITSU_UR_MESSAGE_ID: "4",
    type: "page",
    anonymousId: "anon1",
    userId: "",
    context: {
      traits: {
        email: "test@example.com",
        name: "Test User",
      },
    },
  },
  {
    messageId: "3",
    _JITSU_UR_MESSAGE_ID: "4",
    type: "page",
    anonymousId: "anon1",
    userId: "",
    context: {
      traits: {
        email: "test@example.com",
        name: "Test User",
      },
    },
  },
];

test("user-recognition-test", async () => {
  const store = createStore();
  const eventsStore: Record<string, EventsByAnonId> = {};
  const options: TestOptions = {
    func: UserRecognitionFunction,
    chainCtx: {
      fetch: nodeFetch as unknown as InternalFetchType,
      store: store,
      log: {
        info: (ctx: FunctionContext, msg: any, ...args: any[]) => console.log(prefixLogMessage("INFO", msg), args),
        error: (ctx: FunctionContext, msg: any, ...args: any[]) => console.error(prefixLogMessage("ERROR", msg), args),
        debug: (ctx: FunctionContext, msg: any, ...args: any[]) => console.debug(prefixLogMessage("DEBUG", msg), args),
        warn: (ctx: FunctionContext, msg: any, ...args: any[]) => console.warn(prefixLogMessage("WARN", msg), args),
      },
      anonymousEventsStore: createAnonymousEventsStore(eventsStore),
    },
    ctx: {
      headers: {},
      connection: {
        id: "test",
        options: {
          primaryKey: "messageId",
          deduplicate: true,
        },
      },
      destination: {
        id: "test",
        type: "test",
        updatedAt: new Date(),
        hash: "123",
      },
      source: {
        id: "test",
        type: "browser",
      },
      workspace: {
        id: "test",
      },
      receivedAt: new Date(),
    },
    config: {},
    events: [],
  };
  const copy = JSON.parse(JSON.stringify(anonymousEvents));
  let res = await testJitsuFunction({ ...options, events: copy });
  expect(res).toEqual([]);

  res = await testJitsuFunction({ ...options, events: [identifiedEventEmailOnly] });
  expect(res).toEqual([]);

  res = await testJitsuFunction({ ...options, events: [identifiedEvent] });
  expect(res).toEqual(expectedEvents);

  const fifthEvent = { ...identifiedEvent, messageId: "5" };
  //no more anonymous events
  res = await testJitsuFunction({ ...options, events: [fifthEvent] });
  expect(res).toEqual([]);
});

test("user-recognition-test-email-only", async () => {
  const store = createStore();
  const eventsStore: Record<string, EventsByAnonId> = {};

  const options: TestOptions = {
    func: UserRecognitionFunction,
    chainCtx: {
      fetch: nodeFetch as unknown as InternalFetchType,
      store: store,
      log: {
        info: (ctx: FunctionContext, msg: any, ...args: any[]) => console.log(prefixLogMessage("INFO", msg), args),
        error: (ctx: FunctionContext, msg: any, ...args: any[]) => console.error(prefixLogMessage("ERROR", msg), args),
        debug: (ctx: FunctionContext, msg: any, ...args: any[]) => console.debug(prefixLogMessage("DEBUG", msg), args),
        warn: (ctx: FunctionContext, msg: any, ...args: any[]) => console.warn(prefixLogMessage("WARN", msg), args),
      },
      anonymousEventsStore: createAnonymousEventsStore(eventsStore),
    },
    ctx: {
      headers: {},
      connection: {
        id: "test",
        options: {
          primaryKey: "messageId",
          deduplicate: true,
        },
      },
      destination: {
        id: "test",
        type: "test",
        updatedAt: new Date(),
        hash: "123",
      },
      source: {
        id: "test",
        type: "browser",
      },
      workspace: {
        id: "test",
      },
      receivedAt: new Date(),
    },
    config: {},
    events: [],
  };
  const copy = JSON.parse(JSON.stringify(anonymousEvents));
  let res = await testJitsuFunction({ ...options, events: copy });
  expect(res).toEqual([]);

  res = await testJitsuFunction({ ...options, events: [identifiedEventEmailOnly] });
  expect(res).toEqual([]);

  options.ctx.connection.options.functionsEnv = { IDENTIFYING_TRAITS: "email" };
  res = await testJitsuFunction({ ...options, events: [identifiedEventEmailOnly] });
  expect(res).toEqual(expectedEventsEmailOnly);
});
