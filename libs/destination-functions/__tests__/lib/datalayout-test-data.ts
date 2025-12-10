import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

export const page: AnalyticsServerEvent = {
  messageId: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
  anonymousId: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  context: {
    groupId: "cl9y5kgth0002ccfn3vtqz64g",
    campaign: {
      medium: "medium",
      name: "campaign",
      source: "source",
    },
    library: {
      name: "jitsu-js",
      version: "1.0.0",
    },
    locale: "en-US",
    page: {
      host: "localhost:3088",
      path: "/basic.html",
      referrer: "https://referrer.com",
      referring_domain: "",
      search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
      title: "Tracking page",
      url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
    },
    screen: {
      density: 1,
      height: 720,
      innerHeight: 720,
      innerWidth: 1280,
      width: 1280,
    },
    traits: {
      caseName: "identify-without-user-id",
      CaseLastName: "Doe",
      User_Name: "jj",
      email: "john.doe3@gmail.com",
    },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/107.0.5304.18 Safari/537.36",
  },
  properties: {
    caseName: "page-with-name",
    hash: "",
    height: 720,
    name: "test-page",
    path: "/basic.html",
    search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
    title: "Tracking page",
    url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
    width: 1280,
  },
  sentAt: "2022-11-14T08:56:34.395Z",
  timestamp: "2022-11-14T08:56:34.395Z",
  type: "page",
  userId: "userId2",
};

export const pageExpected = {
  message_id: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
  anonymous_id: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  context: {
    group_id: "cl9y5kgth0002ccfn3vtqz64g",
    campaign: {
      medium: "medium",
      name: "campaign",
      source: "source",
    },
    library: {
      name: "jitsu-js",
      version: "1.0.0",
    },
    locale: "en-US",
    page: {
      host: "localhost:3088",
      path: "/basic.html",
      referrer: "https://referrer.com",
      referring_domain: "",
      search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
      title: "Tracking page",
      url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
    },
    screen: {
      density: 1,
      height: 720,
      inner_height: 720,
      inner_width: 1280,
      width: 1280,
    },
    traits: {
      case_name: "identify-without-user-id",
      email: "john.doe3@gmail.com",
      case_last_name: "Doe",
      user_name: "jj",
    },
    user_agent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/107.0.5304.18 Safari/537.36",
  },
  sent_at: "2022-11-14T08:56:34.395Z",
  timestamp: "2022-11-14T08:56:34.395Z",
  type: "page",
  user_id: "userId2",
  case_name: "page-with-name",
  hash: "",
  height: 720,
  name: "test-page",
  path: "/basic.html",
  search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
  title: "Tracking page",
  url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
  width: 1280,
};

export const pageExpectedSingleTable = {
  message_id: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
  anonymous_id: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  context: {
    group_id: "cl9y5kgth0002ccfn3vtqz64g",
    campaign: {
      medium: "medium",
      name: "campaign",
      source: "source",
    },
    library: {
      name: "jitsu-js",
      version: "1.0.0",
    },
    locale: "en-US",
    page: {
      host: "localhost:3088",
      path: "/basic.html",
      referrer: "https://referrer.com",
      referring_domain: "",
      search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
      title: "Tracking page",
      url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
    },
    screen: {
      density: 1,
      height: 720,
      inner_height: 720,
      inner_width: 1280,
      width: 1280,
    },
    traits: {
      case_name: "identify-without-user-id",
      email: "john.doe3@gmail.com",
      case_last_name: "Doe",
      user_name: "jj",
    },
    user_agent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/107.0.5304.18 Safari/537.36",
  },
  sent_at: "2022-11-14T08:56:34.395Z",
  timestamp: "2022-11-14T08:56:34.395Z",
  type: "page",
  user_id: "userId2",
  case_name: "page-with-name",
  hash: "",
  height: 720,
  name: "test-page",
  path: "/basic.html",
  search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
  title: "Tracking page",
  url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
  width: 1280,
};

export const identify: AnalyticsServerEvent = {
  writeKey: "writeKey",
  messageId: "a6c09b16-c2bc-4193-990f-5e2b694ae610",
  anonymousId: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  context: {
    groupId: "cl9y5kgth0002ccfn3vtqz64g",
    ip: "141.136.89.181",
    campaign: {
      medium: "medium",
      name: "campaign",
      source: "source",
    },
    library: {
      name: "jitsu-js",
      version: "1.0.0",
    },
    locale: "en-US",
    page: {
      host: "localhost:3088",
      path: "/basic.html",
      referrer: "https://referrer.com",
      referring_domain: "referrer.com",
      search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
      title: "Tracking page",
      url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
    },
    screen: {
      density: 1,
      height: 720,
      innerHeight: 720,
      innerWidth: 1280,
      width: 1280,
    },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/107.0.5304.18 Safari/537.36",
  },
  sentAt: "2022-11-14T08:56:34.387Z",
  timestamp: "2022-11-14T08:56:34.387Z",
  traits: {
    caseName: "basic-identify",
    CaseLastName: "Doe",
    User_Name: "jj",
    email: "john.doe2@gmail.com",
  },
  type: "identify",
  userId: "userId2",
};

export const identifyExpected = {
  write_key: "writeKey",
  message_id: "a6c09b16-c2bc-4193-990f-5e2b694ae610",
  anonymous_id: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  context: {
    ip: "141.136.89.181",
    group_id: "cl9y5kgth0002ccfn3vtqz64g",
    campaign: {
      medium: "medium",
      name: "campaign",
      source: "source",
    },
    library: {
      name: "jitsu-js",
      version: "1.0.0",
    },
    locale: "en-US",
    page: {
      host: "localhost:3088",
      path: "/basic.html",
      referrer: "https://referrer.com",
      referring_domain: "referrer.com",
      search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
      title: "Tracking page",
      url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
    },
    screen: {
      density: 1,
      height: 720,
      inner_height: 720,
      inner_width: 1280,
      width: 1280,
    },
    user_agent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/107.0.5304.18 Safari/537.36",
  },
  sent_at: "2022-11-14T08:56:34.387Z",
  timestamp: "2022-11-14T08:56:34.387Z",
  case_name: "basic-identify",
  case_last_name: "Doe",
  user_name: "jj",
  email: "john.doe2@gmail.com",
  user_id: "userId2",
};

export const identifyExpectedSingleTable = {
  write_key: "writeKey",
  message_id: "a6c09b16-c2bc-4193-990f-5e2b694ae610",
  anonymous_id: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  context: {
    ip: "141.136.89.181",
    group_id: "cl9y5kgth0002ccfn3vtqz64g",
    campaign: {
      medium: "medium",
      name: "campaign",
      source: "source",
    },
    library: {
      name: "jitsu-js",
      version: "1.0.0",
    },
    locale: "en-US",
    page: {
      host: "localhost:3088",
      path: "/basic.html",
      referrer: "https://referrer.com",
      referring_domain: "referrer.com",
      search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
      title: "Tracking page",
      url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
    },
    screen: {
      density: 1,
      height: 720,
      inner_height: 720,
      inner_width: 1280,
      width: 1280,
    },
    traits: {
      case_name: "basic-identify",
      case_last_name: "Doe",
      user_name: "jj",
      email: "john.doe2@gmail.com",
    },
    user_agent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/107.0.5304.18 Safari/537.36",
  },
  sent_at: "2022-11-14T08:56:34.387Z",
  timestamp: "2022-11-14T08:56:34.387Z",
  type: "identify",
  user_id: "userId2",
};

export const track: AnalyticsServerEvent = {
  type: "track",
  event: "testEvent",
  properties: {
    testProp: "test event properties",
    nestedObj: {
      nestedProp: "sad",
    },
  },
  userId: "user@example.com",
  anonymousId: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  timestamp: "2022-11-14T08:56:34.395Z",
  sentAt: "2022-11-14T08:56:34.395Z",
  messageId: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
  context: {
    groupId: "cl9y5kgth0002ccfn3vtqz64g",
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
  receivedAt: "2022-11-14T08:56:34.395Z",
};

export const trackExpected = [
  {
    event: "testEvent",
    user_id: "user@example.com",
    anonymous_id: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
    timestamp: "2022-11-14T08:56:34.395Z",
    sent_at: "2022-11-14T08:56:34.395Z",
    message_id: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
    context: {
      group_id: "cl9y5kgth0002ccfn3vtqz64g",
      library: {
        name: "jitsu-js",
        version: "1.0.0",
      },
      ip: "127.0.0.1",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/111.0",
      locale: "en-US",
      screen: {
        width: 2304,
        height: 1296,
        inner_width: 1458,
        inner_height: 1186,
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
    request_ip: "127.0.0.1",
    received_at: "2022-11-14T08:56:34.395Z",
  },
  {
    event: "testEvent",
    test_prop: "test event properties",
    nested_obj: {
      nested_prop: "sad",
    },
    user_id: "user@example.com",
    anonymous_id: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
    timestamp: "2022-11-14T08:56:34.395Z",
    sent_at: "2022-11-14T08:56:34.395Z",
    message_id: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
    context: {
      group_id: "cl9y5kgth0002ccfn3vtqz64g",
      library: {
        name: "jitsu-js",
        version: "1.0.0",
      },
      ip: "127.0.0.1",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/111.0",
      locale: "en-US",
      screen: {
        width: 2304,
        height: 1296,
        inner_width: 1458,
        inner_height: 1186,
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
    request_ip: "127.0.0.1",
    received_at: "2022-11-14T08:56:34.395Z",
  },
];

export const trackExpectedSingleTable = {
  event: "testEvent",
  test_prop: "test event properties",
  nested_obj: {
    nested_prop: "sad",
  },
  user_id: "user@example.com",
  anonymous_id: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  timestamp: "2022-11-14T08:56:34.395Z",
  sent_at: "2022-11-14T08:56:34.395Z",
  message_id: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
  context: {
    group_id: "cl9y5kgth0002ccfn3vtqz64g",
    library: {
      name: "jitsu-js",
      version: "1.0.0",
    },
    ip: "127.0.0.1",
    user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/111.0",
    locale: "en-US",
    screen: {
      width: 2304,
      height: 1296,
      inner_width: 1458,
      inner_height: 1186,
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
  type: "track",
  request_ip: "127.0.0.1",
  received_at: "2022-11-14T08:56:34.395Z",
};

export const group: AnalyticsServerEvent = {
  anonymousId: "fab18d01-fb6a-4845-b9ca-300b9db35527",
  context: {
    campaign: {},
    clientIds: {},
    library: {
      env: "node",
      name: "@jitsu/js",
      version: "2.0.0",
    },
    page: {},
  },
  groupId: "cl9y5kgth0002ccfn3vtqz64g",
  messageId: "17dnlr6evs61jakjuz1xt6",
  receivedAt: "2024-04-08T10:39:20.766Z",
  requestIp: "127.0.0.1",
  sentAt: "2024-04-08T10:39:20.764Z",
  timestamp: "2024-04-08T10:39:20.764Z",
  traits: {
    name: "Ildar Nurislamov's workspace",
    workspaceId: "cl9y5kgth0002ccfn3vtqz64g",
    workspaceName: "Ildar Nurislamov's workspace",
    workspaceSlug: "ildar",
  },
  type: "group",
  writeKey: "n6Cp3jwTGDFUZfD568wgve0mdCmPaT77:***",
};

export const groupExpected = {
  anonymous_id: "fab18d01-fb6a-4845-b9ca-300b9db35527",
  context: {
    campaign: {},
    client_ids: {},
    library: {
      env: "node",
      name: "@jitsu/js",
      version: "2.0.0",
    },
    page: {},
  },
  group_id: "cl9y5kgth0002ccfn3vtqz64g",
  message_id: "17dnlr6evs61jakjuz1xt6",
  received_at: "2024-04-08T10:39:20.766Z",
  request_ip: "127.0.0.1",
  sent_at: "2024-04-08T10:39:20.764Z",
  timestamp: "2024-04-08T10:39:20.764Z",
  name: "Ildar Nurislamov's workspace",
  workspace_id: "cl9y5kgth0002ccfn3vtqz64g",
  workspace_name: "Ildar Nurislamov's workspace",
  workspace_slug: "ildar",
  write_key: "n6Cp3jwTGDFUZfD568wgve0mdCmPaT77:***",
};

export const groupExpectedSingleTable = {
  anonymous_id: "fab18d01-fb6a-4845-b9ca-300b9db35527",
  context: {
    campaign: {},
    client_ids: {},
    group: {
      name: "Ildar Nurislamov's workspace",
      workspace_id: "cl9y5kgth0002ccfn3vtqz64g",
      workspace_name: "Ildar Nurislamov's workspace",
      workspace_slug: "ildar",
    },
    group_id: "cl9y5kgth0002ccfn3vtqz64g",
    library: {
      env: "node",
      name: "@jitsu/js",
      version: "2.0.0",
    },
    page: {},
  },
  message_id: "17dnlr6evs61jakjuz1xt6",
  received_at: "2024-04-08T10:39:20.766Z",
  request_ip: "127.0.0.1",
  type: "group",
  sent_at: "2024-04-08T10:39:20.764Z",
  timestamp: "2024-04-08T10:39:20.764Z",
  write_key: "n6Cp3jwTGDFUZfD568wgve0mdCmPaT77:***",
};
