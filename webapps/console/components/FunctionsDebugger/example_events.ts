import { randomId } from "juava";

export const examplePageEvent = () => {
  return {
    type: "page",
    properties: {
      title: "Example page event",
      url: "https://example.com/",
      path: "/",
      hash: "",
      search: "",
      currency: "USD",
      width: 1458,
      height: 1186,
    },
    userId: "user@example.com",
    anonymousId: randomId(),
    timestamp: new Date(),
    sentAt: new Date(),
    messageId: randomId(),
    writeKey: randomId(),
    context: {
      library: {
        name: "jitsu-js",
        version: "1.0.0",
      },
      ip: "127.0.0.1",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/111.0",
      locale: "en-US",
      screen: {
        width: 2304,
        height: 1296,
        innerWidth: 1458,
        innerHeight: 1186,
        density: 2,
      },
      traits: {
        email: "user@example.com",
      },
      page: {
        path: "/",
        referrer: "",
        referring_domain: "",
        host: "example.com",
        search: "",
        title: "Example page event",
        url: "https://example.com/",
        encoding: "UTF-8",
      },
      campaign: {
        name: "example",
        source: "g",
      },
    },
    requestIp: "127.0.0.1",
    receivedAt: new Date(),
  };
};

export const exampleIdentifyEvent = () => {
  return {
    type: "identify",
    userId: "user@example.com",
    traits: {
      email: "user@example.com",
    },
    anonymousId: randomId(),
    timestamp: new Date(),
    sentAt: new Date(),
    messageId: randomId(),
    writeKey: randomId(),
    context: {
      library: {
        name: "jitsu-js",
        version: "1.0.0",
      },
      ip: "127.0.0.1",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/113.0",
      locale: "en-US",
      screen: {
        width: 2304,
        height: 1296,
        innerWidth: 2304,
        innerHeight: 1186,
        density: 2,
      },
      page: {
        path: "/",
        referrer: "",
        referring_domain: "",
        host: "example.com",
        search: "",
        title: "Example page event",
        url: "https://example.com/",
        encoding: "UTF-8",
      },
      campaign: {
        name: "example",
        source: "g",
      },
    },
    requestIp: "127.0.0.1",
    receivedAt: new Date(),
  };
};

export const exampleTrackEvents = () => {
  return {
    type: "track",
    event: "testEvent",
    properties: {
      testProp: "test event properties",
    },
    userId: "user@example.com",
    anonymousId: randomId(),
    timestamp: new Date(),
    sentAt: new Date(),
    messageId: randomId(),
    writeKey: randomId(),
    context: {
      library: {
        name: "jitsu-js",
        version: "1.0.0",
      },
      ip: "127.0.0.1",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/111.0",
      locale: "en-US",
      screen: {
        width: 2304,
        height: 1296,
        innerWidth: 1458,
        innerHeight: 1186,
        density: 2,
      },
      traits: {
        email: "user@example.com",
      },
      page: {
        path: "/",
        referrer: "",
        referring_domain: "",
        host: "example.com",
        search: "",
        title: "Example page event",
        url: "https://example.com/",
        encoding: "UTF-8",
      },
      campaign: {
        name: "example",
        source: "g",
      },
    },
    requestIp: "127.0.0.1",
    receivedAt: new Date(),
  };
};
