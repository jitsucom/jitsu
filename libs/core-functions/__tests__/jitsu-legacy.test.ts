import { jitsuLegacy, MappedEvent, segmentLayout } from "../src/functions/bulker-destination";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import type { Event as JitsuLegacyEvent } from "@jitsu/sdk-js";

const identify: AnalyticsServerEvent = {
  writeKey: "writeKey",
  messageId: "a6c09b16-c2bc-4193-990f-5e2b694ae610",
  anonymousId: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  context: {
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
    email: "john.doe2@gmail.com",
  },
  type: "identify",
  userId: "userId2",
};

const legacyIdentifyExpected: Omit<JitsuLegacyEvent, "local_tz_offset"> & { local_tz_offset?: number } = {
  anon_ip: "141.136.89.0",
  doc_path: "/basic.html",
  doc_search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
  source_ip: "141.136.89.181",
  api_key: "writeKey",

  click_id: {},
  doc_host: "localhost",
  eventn_ctx_event_id: "a6c09b16-c2bc-4193-990f-5e2b694ae610",
  event_type: "identify",
  page_title: "Tracking page",
  referer: "https://referrer.com",
  src: "jitsu",
  url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
  user: {
    id: "userId2",
    email: "john.doe2@gmail.com",
    case_name: "basic-identify",
  },
  user_agent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/107.0.5304.18 Safari/537.36",
  user_language: "en-US",
  utc_time: "2022-11-14T08:56:34.387Z",
  utm: {
    medium: "medium",
    name: "campaign",
    source: "source",
  },
  vp_size: "",
};

const page: AnalyticsServerEvent = {
  messageId: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
  anonymousId: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  context: {
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

const legacyPageExpected = {
  api_key: "",
  click_id: {},
  doc_host: "localhost",
  doc_path: "/basic.html",
  doc_search: "?utm_source=source&utm_medium=medium&utm_campaign=campaign",
  eventn_ctx_event_id: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
  event_type: "page",
  page_title: "Tracking page",
  referer: "https://referrer.com",
  src: "jitsu",
  url: "https://localhost:3088/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign",
  user: {
    id: "userId2",
    email: "john.doe3@gmail.com",
    case_name: "identify-without-user-id",
  },
  user_agent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/107.0.5304.18 Safari/537.36",
  user_language: "en-US",
  utc_time: "2022-11-14T08:56:34.395Z",
  utm: {
    medium: "medium",
    name: "campaign",
    source: "source",
  },
  vp_size: "1280x720",
};

test("legacy event", () => {
  const identifyLegacyResult = jitsuLegacy(identify).event;
  const pageLegacyResult = jitsuLegacy(page).event;
  // console.log(JSON.stringify(identifyLegacyResult, null, 2));
  // expect(identifyLegacyResult).toStrictEqual(legacyIdentifyExpected);

  console.log(JSON.stringify(pageLegacyResult, null, 2));
  expect(pageLegacyResult).toStrictEqual(legacyPageExpected);
});

const pageSegmentExpected = {
  message_id: "d0c6abf6-97f7-487a-a197-8f236c728fa8",
  anonymous_id: "6638caf0-d2c2-4bc0-aecf-8b290b559a37",
  context: {
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

test("segment event", () => {
  const pageSegmentResult = segmentLayout(page, false);
  expect(Array.isArray(pageSegmentResult)).toBe(false);
  const pageSegment = (pageSegmentResult as MappedEvent).event;
  console.log(JSON.stringify(pageSegment, null, 2));
  expect(pageSegment).toStrictEqual(pageSegmentExpected);
});
