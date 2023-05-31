import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import UserRecognitionFunction, { UserRecognitionConfig } from "../src/functions/user-recognition";
import { testJitsuFunction, TestOptions } from "./lib/testing-lib";
import { createAnonymousEventsStore } from "./lib/mem-store";

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
  const options: TestOptions = {
    func: UserRecognitionFunction,
    ctx: {
      headers: {},
      connection: {
        id: "test",
        options: {
          primaryKey: "messageId",
          deduplicate: true,
        },
      },
      $system: {
        anonymousEventsStore: createAnonymousEventsStore(),
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
