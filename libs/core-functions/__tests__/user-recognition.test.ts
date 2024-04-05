import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import UserRecognitionFunction, { UserRecognitionConfig } from "../src/functions/user-recognition";
import { prefixLogMessage, testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { createAnonymousEventsStore, createStore } from "./lib/mem-store";
import nodeFetch from "node-fetch-commonjs";
import { FetchType, FunctionContext } from "../src";

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
  type: "page",
  anonymousId: "anon1",
  userId: "user1",
  context: {
    traits: {
      email: "test@example.com",
      name: "Test User",
    },
  },
};

const expectedEvents: AnalyticsServerEvent[] = [
  {
    messageId: "4",
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
    messageId: "1",
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

test("user-recognition-test", async () => {
  const store = createStore();
  const options: TestOptions = {
    funcWrapper: UserRecognitionFunction,
    chainCtx: {
      fetch: nodeFetch as unknown as FetchType,
      store: store,
      log: {
        info: (ctx: FunctionContext, msg: any, ...args: any[]) => console.log(prefixLogMessage("INFO", msg), args),
        error: (ctx: FunctionContext, msg: any, ...args: any[]) => console.error(prefixLogMessage("ERROR", msg), args),
        debug: (ctx: FunctionContext, msg: any, ...args: any[]) => console.debug(prefixLogMessage("DEBUG", msg), args),
        warn: (ctx: FunctionContext, msg: any, ...args: any[]) => console.warn(prefixLogMessage("WARN", msg), args),
      },
      anonymousEventsStore: createAnonymousEventsStore(),
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
    },
    config: {} as UserRecognitionConfig,
    events: [],
  };
  let res = await testJitsuFunction({ ...options, events: anonymousEvents });
  expect(res).toEqual(anonymousEvents);

  res = await testJitsuFunction({ ...options, events: [identifiedEvent] });
  expect(res).toEqual(expectedEvents);

  const fifthEvent = { ...identifiedEvent, messageId: "5" };
  //no more anonymous events
  res = await testJitsuFunction({ ...options, events: [fifthEvent] });
  expect(res).toEqual([fifthEvent]);
});
