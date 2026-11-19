import { BrowserContext, devices, expect, Page, test } from "@playwright/test";
import { createServer, SimpleSyrup } from "../simple-syrup";
import * as fs from "fs";
import * as path from "path";
import ejs from "ejs";
// import chalk from "chalk";
import * as process from "process";
import { AnalyticsClientEvent, AnalyticsInterface } from "@jitsu/protocols/analytics.d";

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
});

const chalk = {
  cyan: (str: string) => str,
  bold: (str: string) => str,
};

const express = require("express");
const cookieParser = require("cookie-parser");
const app = express();
//const forge = require("node-forge");

let server: SimpleSyrup;

let requestLog: { type: string; body: AnalyticsClientEvent; headers: any }[] = [];

test.beforeAll(async () => {
  const testCasesHandlers = fs.readdirSync(path.join(__dirname, "cases")).reduce((res, file) => {
    console.log("Processing file", file);
    return {
      ...res,
      [`/${file}`]: (req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.send(
          ejs.compile(
            fs.readFileSync(path.join(__dirname, "cases", file)).toString(),
            {}
          )({
            trackingBase: server.baseUrl,
          })
        );
      },
    };
  }, {});
  server = await createServer({
    port: 3088,
    https: process.env.DISABLE_HTTPS !== "1" && process.env.DISABLE_HTTPS !== "true",
    handlers: {
      "/viewport-history.html": (_req, res) => {
        res.type("html").send('<!doctype html><script src="/p.js" data-init-only="true" defer></script>');
      },
      "/p.js": (req, res) => {
        res.setHeader("Content-Type", "text/javascript");
        res.send(fs.readFileSync(path.join(__dirname, "../../dist/web/p.js.txt")).toString());
      },
      "/api/s/:type": async (req, res) => {
        //sleep for 30ms to simulate network latency. It helps catch bugs with async processing
        await new Promise(resolve => setTimeout(resolve, 50));

        res.setHeader("Content-Type", "text/javascript");
        res.send({ ok: true });
        requestLog.push({
          type: req.params.type,
          headers: req.headers,
          body: req.body,
        });
      },
      ...testCasesHandlers,
    },
  });
  console.log("Running on " + server.baseUrl);
});

test.afterAll(async () => {
  await server?.close();
});

function sortKeysRecursively(obj: any): any {
  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    return Object.keys(obj)
      .sort()
      .reduce((res, key) => {
        res[key] = sortKeysRecursively(obj[key]);
        return res;
      }, {});
  }
  return obj;
}

function shouldKeepBrowserOpen() {
  return process.env.KEEP_BROWSER_OPEN === "true" || process.env.KEEP_BROWSER_OPEN === "1";
}

async function createLoggingPage(browserContext: BrowserContext): Promise<{ page: Page; uncaughtErrors: Error[] }> {
  const page = await browserContext.newPage();
  const errors: Error[] = [];

  page.on("pageerror", error => {
    errors.push(error);
    const border = chalk.cyan("│");
    console.log();
    console.log(`${border} ${chalk.cyan(`Browser Console UNCAUGHT ERROR:`)}`);
    console.log(`${border} ` + error.stack.split("\n").join(`\n${border} `));
  });

  page.on("console", msg => {
    const border = chalk.cyan("│");
    console.log();
    console.log(`${border} ${chalk.cyan(`Browser Console ${msg.type().toUpperCase()}`)}`);
    console.log(`${border} ` + msg.text().split("\n").join(`\n${border} `));
  });
  return { page, uncaughtErrors: errors };
}

const generateTestEvents = async () => {
  const implName = `${window["analytics"] ? "segment" : "jitsu"}`;
  const analytics = (window["analytics"] || window["jitsu"]) as AnalyticsInterface;
  console.log(`Generating test events. Implementation ${implName}: ${Object.keys(analytics)}`);
  await analytics.identify("userId2", { email: "john.doe2@gmail.com", caseName: "basic-identify" });
  await analytics.page("test-page-right-after-identify", { caseName: "test-page-right-after-identify" });
  // jitsu must extract traits even from 'id' object
  await analytics.identify({ email: "john.doe3@gmail.com", caseName: "identify-without-user-id" });
  await analytics.group("group1", { name: "Group 1", caseName: "basic-group" });
  await analytics.page({ caseName: "page-without-name", context: { page: { title: "Synthetic Title" } } });
  await analytics.page("test-page", { caseName: "page-with-name" });
  await analytics.track("testEvent", { caseName: "track-with-name" });
  await analytics.identify(9292649175 as any, { caseName: "identify-with-numeric-id-1" });
  console.log(`Test events for ${implName} has been generated`);
};

/**
 * This test isn't really testing anything. It generates reference segment events
 */
test("segment-reference", async ({ browser }) => {
  if (!process.env.SEGMENT_WRITE_KEY) {
    console.log("Skipping segment reference generation, no SEGMENT_WRITE_KEY provided");
    return;
  }
  // Using the browser fixture, you can get access to the BrowserContext
  const browserContext = await browser.newContext();
  const { page } = await createLoggingPage(browserContext);
  const requests: Record<string, { payload: any }[]> = {};
  page.on("response", async response => {
    const request = response.request();
    const apiPrefix = "https://api.segment.io/v1/";
    if (request.url().startsWith(apiPrefix) && request.method() === "POST") {
      const type = request.url().substring(apiPrefix.length);
      requests[type] = requests[type] || [];
      requests[type].push({
        payload: await request.postDataJSON(),
      });
    }
    console.log(`Request ${request.method()} ${request.url()} → ${response.status()}`);
  });

  await page.goto(`${server.baseUrl}/segment-reference.html?utm_source=source&utm_medium=medium&utm_campaign=campaign`);

  await page.waitForFunction(() => window["__analyticsReady"] === true, undefined, {
    timeout: 5000,
    polling: 100,
  });
  console.log("Segment has been page loaded. Sending events");
  await page.evaluate(generateTestEvents);
  const cookies = (await browserContext.cookies()).reduce(
    (res, cookie) => ({
      ...res,
      [cookie.name]: cookie.value,
    }),
    {}
  );
  console.log("🍪 Segment Cookies", cookies);
  let counter = 1;
  for (const type of Object.keys(requests)) {
    for (const { payload } of requests[type]) {
      const dir = path.join(__dirname, "artifacts", "segment-reference");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(
        dir,
        `${counter++} - ${payload.traits?.caseName || payload.properties?.caseName || payload.context?.caseName}.json`
      );
      fs.writeFileSync(file, JSON.stringify(sortKeysRecursively(payload), null, 2));
    }
  }
});

function describeEvent(type: string, body: any) {
  const params = [
    body.userId ? "userId=" + body.userId : undefined,
    body.anonymousId ? "anonId=" + body.anonymousId : undefined,
    body.traits ? ["traits=" + JSON.stringify(body.traits)] : [],
  ]
    .filter(x => !!x)
    .join(", ");
  return `${type}${type === "track" ? `(${body.event})` : ""}[${params}]`;
}

function clearRequestLog() {
  requestLog.length = 0;
}

test("jitsu-queue-callbacks", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([page.goto(`${server.baseUrl}/callbacks.html`)]);
  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log(
    `📝 Request log size of ${requestLog.length}`,
    requestLog.map(x => describeEvent(x.type, x.body))
  );
  expect(requestLog.length).toBe(3);
});

// Skip this test because jitsu-js no longer relies on canonical URL
test.skip("url-bug", async ({ browser, context }) => {
  //tests a bug in getanalytics.io where the url without slash provided by
  //<link rel="canonical" ../> causes incorrect page path
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([page.goto(`${server.baseUrl}/url-bug.html`)]);

  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult.status()).toBe(200);
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);
  expect(requestLog.length).toBe(2);
  console.log(
    `📝 Request log size of ${requestLog.length}`,
    requestLog.map(x => describeEvent(x.type, x.body))
  );
  //a track contains a valid URL, probably because analytics can't grab the canonical URL yet
  const trackEvent = requestLog.find(x => x.type === "page");
  expect(trackEvent).toBeDefined();
  const pagePath = trackEvent.body.context.page.path;
  expect(pagePath).toBeDefined();
  //it's  "//localhost:3088" when the bug is present
  expect(pagePath).toEqual("/");
});

test("reset", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([page.goto(`${server.baseUrl}/reset.html`)]);
  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult.status()).toBe(200);
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);
  expect(requestLog.length).toBe(3);
  console.log(
    `📝 Request log size of ${requestLog.length}`,
    requestLog.map(x => describeEvent(x.type, x.body))
  );
  const [identifyEvent, firstTrack, secondTrack] = requestLog;
  expect(firstTrack.body.anonymousId).toEqual("john-doe-id-1");

  const cookies = await browserContext.cookies();
  // all cookies should be cleared by .reset()
  // but new cookie for new anonymousId should be set
  expect(cookies.length).toBe(1);
  expect(cookies[0].name).toEqual("__eventn_id");
  const newAnonymousId = cookies[0].value;
  console.log(`🍪Cookies`, cookies);

  //second identify call should not reach the server, but it should change the traits
  expect(firstTrack.body.context.traits?.email).toEqual("john2@example.com");

  expect(secondTrack.body.anonymousId).not.toBeNull();
  expect(secondTrack.body.anonymousId).toBeDefined();
  expect(secondTrack.body.anonymousId).toEqual(newAnonymousId);
  expect(secondTrack.body.anonymousId).not.toEqual("john-doe-id-1");
});

const generateEventsForConsentTests = async () => {
  const analytics = window["jitsu"] as AnalyticsInterface;
  await analytics.identify("myUserId", { email: "myUserId@example.com" });
  await analytics.group("myGroupId", { name: "myGroupId" });
  await analytics.page("myPage");
};

test("ip-policy", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([page.goto(`${server.baseUrl}/ip-policy.html`)]);
  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult?.status()).toBe(200);
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);
  expect(requestLog.length).toBe(1);
  const p = requestLog[0];
  expect(p.headers?.["x-ip-policy"]).toEqual("stripLastOctet");
});

test("dont-send", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([page.goto(`${server.baseUrl}/dont-send.html`)]);
  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult?.status()).toBe(200);
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);
  expect(requestLog.length).toBe(0);
  await page.evaluate(generateEventsForConsentTests);

  const cookies = await browserContext.cookies();

  expect(uncaughtErrors.length).toEqual(0);
  expect(requestLog.length).toBe(0);
  expect(cookies.length).toBe(0);
});

test("dont-send-then-consent", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([page.goto(`${server.baseUrl}/dont-send.html`)]);
  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult?.status()).toBe(200);
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);
  expect(requestLog.length).toBe(0);

  await page.evaluate(async () => {
    const analytics = window["jitsu"] as AnalyticsInterface;
    analytics.configure({
      privacy: {
        dontSend: false,
        consentCategories: {
          analytics: true,
        },
      },
    });
  });
  await page.evaluate(generateEventsForConsentTests);
  await new Promise(resolve => setTimeout(resolve, 1000));

  const cookies = await browserContext.cookies();
  expect(uncaughtErrors.length).toEqual(0);
  expect(requestLog.length).toBe(3);
  expect(cookies.length).toBe(5);
  const p = requestLog[2];
  expect(p.type).toEqual("page");
  expect(p.body.userId).toEqual("myUserId");
  expect(p.body.groupId).toEqual("myGroupId");
  expect(p.body.context?.traits?.email).toEqual("myUserId@example.com");
  expect(p.body.context?.consent?.categoryPreferences).toEqual({ analytics: true });
  expect((p.body.anonymousId ?? "").length).toBeGreaterThan(0);
});

test("disable-user-ids", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([page.goto(`${server.baseUrl}/disable-user-ids.html`)]);
  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult?.status()).toBe(200);
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);

  expect(requestLog.length).toBe(0);
  await page.evaluate(generateEventsForConsentTests);

  const cookies = await browserContext.cookies();

  expect(uncaughtErrors.length).toEqual(0);
  expect(cookies.length).toBe(0);
  expect(requestLog.length).toBe(1);
  const p = requestLog[0];
  expect(p.type).toEqual("page");
  expect(p.body.userId).toBeUndefined();
  expect(p.body.groupId).toBeUndefined();
  expect(p.body.context?.traits?.email).toBeUndefined();
  expect(p.body.anonymousId).toBeUndefined();
  expect(p.body.properties?.path).toBe("/disable-user-ids.html");
});

test("disable-user-ids-then-consent", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([page.goto(`${server.baseUrl}/disable-user-ids.html`)]);
  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult?.status()).toBe(200);
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);
  expect(requestLog.length).toBe(0);
  await page.evaluate(generateEventsForConsentTests);
  let cookies = await browserContext.cookies();
  expect(uncaughtErrors.length).toEqual(0);
  expect(cookies.length).toBe(0);
  expect(requestLog.length).toBe(1);

  await page.evaluate(async () => {
    const analytics = window["jitsu"] as AnalyticsInterface;
    analytics.configure({
      privacy: {
        disableUserIds: false,
        consentCategories: {
          analytics: true,
        },
      },
    });
  });
  await page.evaluate(generateEventsForConsentTests);
  await new Promise(resolve => setTimeout(resolve, 1000));

  cookies = await browserContext.cookies();
  expect(uncaughtErrors.length).toEqual(0);
  expect(requestLog.length).toBe(4);
  expect(cookies.length).toBe(5);
  const p = requestLog[3];
  expect(p.type).toEqual("page");
  expect(p.body.userId).toEqual("myUserId");
  expect(p.body.groupId).toEqual("myGroupId");
  expect(p.body.context?.traits?.email).toEqual("myUserId@example.com");
  expect(p.body.context?.consent?.categoryPreferences).toEqual({ analytics: true });
  expect((p.body.anonymousId ?? "").length).toBeGreaterThan(0);
});

test("anonymous-id-bug", async ({ browser }) => {
  clearRequestLog();
  const anonymousId = "1724633695283.638279";
  const browserContext = await browser.newContext();
  await browserContext.addCookies([{ name: "__eventn_id", value: anonymousId, url: server.baseUrl }]);
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([page.goto(`${server.baseUrl}/anonymous-id-bug.html`)]);
  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult.status()).toBe(200);
  const cookies = (await browserContext.cookies()).reduce(
    (res, cookie) => ({
      ...res,
      [cookie.name]: cookie.value,
    }),
    {}
  );
  console.log("🍪 Jitsu Cookies", cookies);
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);
  console.log(
    `📝 Request log size of ${requestLog.length}`,
    requestLog.map(x => describeEvent(x.type, x.body))
  );
  const p = requestLog[0];
  console.log(chalk.bold("📝 Checking page event"), JSON.stringify(p, null, 3));
  expect(p.body.anonymousId).toEqual(anonymousId);
});

test("cookie-names", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);
  const pageResult = await page.goto(`${server.baseUrl}/cookie-names.html`);
  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult.status()).toBe(200);
  const cookies = (await browserContext.cookies()).reduce(
    (res, cookie) => ({
      ...res,
      [cookie.name]: cookie.value,
    }),
    {}
  );
  console.log("🍪 Jitsu Cookies", cookies);
  expect(cookies).toHaveProperty("my_anon_ck");
  const anonymousId = cookies["my_anon_ck"];

  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);
  console.log(
    `📝 Request log size of ${requestLog.length}`,
    requestLog.map(x => describeEvent(x.type, x.body))
  );
  expect(requestLog[0].body.anonymousId).toEqual(anonymousId);

  const { page: secondPage } = await createLoggingPage(browserContext);
  const pageResult2 = await secondPage.goto(
    `${server.baseUrl}/cookie-names.html?utm_source=source&utm_medium=medium&utm_campaign=campaign`
  );
  await secondPage.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult2.status()).toBe(200);
  const cookies2 = (await browserContext.cookies()).reduce(
    (res, cookie) => ({
      ...res,
      [cookie.name]: cookie.value,
    }),
    {}
  );
  console.log("🍪 Jitsu Cookies", cookies2);
  expect(cookies2).toHaveProperty("my_anon_ck");
  expect(cookies["my_anon_ck"]).toEqual(anonymousId);

  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(uncaughtErrors.length).toEqual(0);
  console.log(
    `📝 Request log size of ${requestLog.length}`,
    requestLog.map(x => describeEvent(x.type, x.body))
  );
  expect(requestLog[1].body.anonymousId).toEqual(anonymousId);
});

test("spa-navigation", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  const { page, uncaughtErrors } = await createLoggingPage(browserContext);

  const initialUrl = `${server.baseUrl}/spa-navigation.html`;
  const pageResult = await page.goto(initialUrl);

  await page.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });

  expect(pageResult.status()).toBe(200);

  await page.waitForFunction(() => window["__spaTestComplete"] === true, undefined, {
    timeout: 2000,
    polling: 100,
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  expect(uncaughtErrors.length).toEqual(0);

  console.log(
    `📝 Request log size of ${requestLog.length}`,
    requestLog.map(x => describeEvent(x.type, x.body))
  );

  const pageEvents = requestLog.filter(x => x.type === "page");
  const trackEvents = requestLog.filter(x => x.type === "track");

  expect(pageEvents.length).toBe(6);
  expect(trackEvents.length).toBe(6);

  //expect(pageEvents[0].body.name).toBe("initial-page");
  expect(pageEvents[0].body.properties.path).toBe("/spa-navigation.html");
  expect(pageEvents[0].body.properties.url).toContain("/spa-navigation.html");
  expect(pageEvents[0].body.context.page.path).toBe("/spa-navigation.html");
  expect(pageEvents[0].body.context.page.url).toContain("/spa-navigation.html");

  expect(pageEvents[1].body.properties.path).toBe("/page1");
  expect(pageEvents[1].body.properties.url).toContain("/page1");
  expect(pageEvents[1].body.properties.search).toBe("");
  expect(pageEvents[1].body.properties.hash).toBe("");
  expect(pageEvents[1].body.context.page.path).toBe("/page1");
  expect(pageEvents[1].body.context.page.url).toContain("/page1");
  expect(pageEvents[1].body.context.page.search).toBe("");

  expect(pageEvents[2].body.properties.path).toBe("/page2");
  expect(pageEvents[2].body.properties.url).toContain("/page2?param1=value1");
  expect(pageEvents[2].body.properties.search).toBe("?param1=value1");
  expect(pageEvents[2].body.properties.hash).toBe("");
  expect(pageEvents[2].body.context.page.path).toBe("/page2");
  expect(pageEvents[2].body.context.page.url).toContain("/page2?param1=value1");
  expect(pageEvents[2].body.context.page.search).toBe("?param1=value1");

  expect(pageEvents[3].body.properties.path).toBe("/page3");
  expect(pageEvents[3].body.properties.url).toContain("/page3?param1=value1&param2=value2");
  expect(pageEvents[3].body.properties.search).toBe("?param1=value1&param2=value2");
  expect(pageEvents[3].body.properties.hash).toBe("#section1");
  expect(pageEvents[3].body.context.page.path).toBe("/page3");
  expect(pageEvents[3].body.context.page.url).toContain("/page3?param1=value1&param2=value2");
  expect(pageEvents[3].body.context.page.search).toBe("?param1=value1&param2=value2");

  expect(pageEvents[4].body.properties.path).toBe("/page4/subpage");
  expect(pageEvents[4].body.properties.url).toContain("/page4/subpage");
  expect(pageEvents[4].body.properties.search).toBe("");
  expect(pageEvents[4].body.properties.hash).toBe("#section2");
  expect(pageEvents[4].body.context.page.path).toBe("/page4/subpage");
  expect(pageEvents[4].body.context.page.url).toContain("/page4/subpage");
  expect(pageEvents[4].body.context.page.search).toBe("");

  expect(pageEvents[5].body.properties.path).toBe("/final");
  expect(pageEvents[5].body.properties.url).toContain("/final?utm_source=test&utm_medium=spa");
  expect(pageEvents[5].body.properties.search).toBe("?utm_source=test&utm_medium=spa");
  expect(pageEvents[5].body.properties.hash).toBe("#top");
  expect(pageEvents[5].body.context.page.path).toBe("/final");
  expect(pageEvents[5].body.context.page.url).toContain("/final?utm_source=test&utm_medium=spa");
  expect(pageEvents[5].body.context.page.search).toBe("?utm_source=test&utm_medium=spa");

  const navTrackEvents = trackEvents.filter(x => x.body.event === "navigation");
  expect(navTrackEvents.length).toBe(5);

  expect(navTrackEvents[0].body.context.page.path).toBe("/page1");
  expect(navTrackEvents[1].body.context.page.url).toContain("/page2?param1=value1");
  expect(navTrackEvents[1].body.context.page.path).toBe("/page2");
  expect(navTrackEvents[1].body.context.page.search).toBe("?param1=value1");
  expect(navTrackEvents[2].body.context.page.url).toContain("/page3?param1=value1&param2=value2#section1");
  expect(navTrackEvents[2].body.context.page.path).toBe("/page3");
  expect(navTrackEvents[2].body.context.page.search).toBe("?param1=value1&param2=value2");
  expect(navTrackEvents[3].body.context.page.url).toContain("/page4/subpage#section2");
  expect(navTrackEvents[3].body.context.page.path).toBe("/page4/subpage");
  expect(navTrackEvents[4].body.context.page.url).toContain("/final?utm_source=test&utm_medium=spa#top");
  expect(navTrackEvents[4].body.context.page.path).toBe("/final");
  expect(navTrackEvents[4].body.context.page.search).toBe("?utm_source=test&utm_medium=spa");
});

async function openViewportTestPage(page: Page, scriptAttributes = "") {
  await page.route("**/viewport-test.html", route =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Viewport test</title><script src="/p.js" data-init-only="true" ${scriptAttributes} defer></script>`,
    })
  );
  await page.addInitScript(() => {
    window["viewportReads"] = { innerWidth: 0, innerHeight: 0 };
    for (const key of ["innerWidth", "innerHeight"]) {
      const descriptor = Object.getOwnPropertyDescriptor(window, key)!;
      Object.defineProperty(window, key, {
        ...descriptor,
        get() {
          window["viewportReads"][key]++;
          // lets a test change the viewport at an exact moment, without a real resize
          return window["viewportOverride"]?.[key] ?? descriptor.get!.call(window);
        },
      });
    }
  });
  await page.goto(`${server.baseUrl}/viewport-test.html`);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

test("only the first send after invalidation measures the viewport", async ({ page }) => {
  await openViewportTestPage(page);
  // the SDK fills the cache after the first rendered frame, before any send
  await page.waitForFunction(() => window["viewportReads"].innerWidth === 1);
  const counts = await page.evaluate(async () => {
    const reads = () => ({ ...window["viewportReads"] });
    const history = [reads()];
    const pending = [window["jitsu"].group("warm-viewport")];
    history.push(reads());
    for (let i = 0; i < 3; i++) {
      document.body.style.padding = `${i + 1}px`;
      document.body.dispatchEvent(new Event("resize", { bubbles: true }));
      pending.push(window["jitsu"].group("cached-viewport"));
    }
    history.push(reads());
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    history.push(reads());
    pending.push(window["jitsu"].group("resized-viewport"));
    history.push(reads());
    pending.push(window["jitsu"].group("cached-again"));
    history.push(reads());
    await Promise.all(pending);
    return history;
  });
  expect(counts).toEqual([1, 1, 1, 1, 2, 2].map(count => ({ innerWidth: count, innerHeight: count })));
});

test("the cache is filled after the first frame, so even the first send reads nothing", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openViewportTestPage(page);
  await page.waitForFunction(() => window["viewportReads"].innerWidth === 1);
  const warm = await page.evaluate(() => ({ ...window["viewportReads"] }));
  await page.evaluate(() => window["jitsu"].group("first-send"));
  expect(await page.evaluate(() => window["viewportReads"])).toEqual(warm);
  expect(requestLog.find(entry => entry.body.groupId === "first-send")?.body.context.screen).toMatchObject({
    innerWidth: 800,
    innerHeight: 600,
  });
});

test("a resize refills the cache after the frame, so the next send reads nothing", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openViewportTestPage(page);
  // the cache is warm however it got filled, and any start-up measurement has finished
  await page.evaluate(() => window["jitsu"].group("warm-before-resize"));
  await page.waitForTimeout(250);
  const warm = await page.evaluate(() => ({ ...window["viewportReads"] }));
  await page.setViewportSize({ width: 640, height: 480 });
  // refilled by the SDK itself, not by a send
  await page.waitForFunction(before => window["viewportReads"].innerWidth > before, warm.innerWidth);
  await page.waitForTimeout(250);
  const refilled = await page.evaluate(() => ({ ...window["viewportReads"] }));
  await page.evaluate(() => window["jitsu"].group("after-refill"));
  expect(await page.evaluate(() => window["viewportReads"])).toEqual(refilled);
  expect(requestLog.find(entry => entry.body.groupId === "after-refill")?.body.context.screen).toMatchObject({
    innerWidth: 640,
    innerHeight: 480,
  });
});

test("a send from a relayed resize handler reports the new viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  // registered before the SDK, so it runs ahead of the SDK's own resize listener
  await page.addInitScript(() => {
    window.addEventListener("resize", () => window.dispatchEvent(new CustomEvent("app-relay")), true);
    window.addEventListener("app-relay", () => {
      window["outerInRelay"] = { width: window.outerWidth, height: window.outerHeight };
      window["jitsu"]?.group("relayed-send");
    });
  });
  await openViewportTestPage(page);
  await page.evaluate(() => window["jitsu"].track("warm-before-relay"));
  const outerBefore = await page.evaluate(() => window.outerWidth);
  await page.setViewportSize({ width: 640, height: 480 });
  await expect
    .poll(() => requestLog.find(entry => entry.body.groupId === "relayed-send")?.body.context.screen)
    .toBeTruthy();
  // The SDK can only see a change that its free readings already show. Chromium Headless Shell sometimes updates
  // outerWidth after the resize event, and then the old size is all the SDK has to go on.
  const outerInRelay = await page.evaluate(() => window["outerInRelay"]);
  test.skip(outerInRelay.width === outerBefore, "the browser had not updated outerWidth when the resize event fired");
  expect(requestLog.find(entry => entry.body.groupId === "relayed-send")?.body.context.screen).toMatchObject({
    innerWidth: 640,
    innerHeight: 480,
  });
});

test("a send from a screen orientation handler reports the rotated viewport", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.route("**/viewport-rotate.html", route =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rotate</title><script src="/p.js" data-init-only="true" defer></script>',
    })
  );
  await page.goto(`${server.baseUrl}/viewport-rotate.html`);
  await page.waitForFunction(() => !!window["jitsu"]);
  await page.evaluate(() => {
    // registered after the SDK started, but the browser runs it before the SDK's resize listeners
    screen.orientation.addEventListener("change", () => {
      window["liveInOrientationHandler"] = window.innerWidth;
      window["jitsu"].group("orientation-send");
    });
  });
  await page.evaluate(() => window["jitsu"].track("warm-before-rotation"));
  await page.waitForTimeout(300);
  const portrait = await page.evaluate(() => window.innerWidth);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 915,
    height: 412,
    deviceScaleFactor: 2.625,
    mobile: true,
    screenOrientation: { type: "landscapePrimary", angle: 90 },
  });
  await expect.poll(() => page.evaluate(() => window["liveInOrientationHandler"])).toBeGreaterThan(portrait);
  const live = await page.evaluate(() => window["liveInOrientationHandler"]);
  await expect
    .poll(() => requestLog.find(entry => entry.body.groupId === "orientation-send")?.body.context.screen.innerWidth)
    .toBe(live);
  await context.close();
});

test("a send in the same task as a viewport meta change reports the new viewport", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.route("**/viewport-meta.html", route =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta name="viewport" content="width=400"><title>Viewport meta</title><script src="/p.js" data-init-only="true" defer></script>',
    })
  );
  await page.goto(`${server.baseUrl}/viewport-meta.html`);
  await page.waitForFunction(() => !!window["jitsu"]);
  await page.evaluate(() => window["jitsu"].track("warm-before-meta"));
  await page.waitForTimeout(300);
  const live = await page.evaluate(async () => {
    document.querySelector('meta[name="viewport"]')!.setAttribute("content", "width=800");
    const width = window.innerWidth;
    await window["jitsu"].group("meta-same-task");
    return width;
  });
  expect(live).toBeGreaterThan(600);
  expect(requestLog.find(entry => entry.body.groupId === "meta-same-task")?.body.context.screen.innerWidth).toBe(live);
  await context.close();
});

test("a send in the same task as a second viewport meta tag reports the new viewport", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.route("**/viewport-two-metas.html", route =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta name="viewport" content="width=400"><title>Two metas</title><script src="/p.js" data-init-only="true" defer></script>',
    })
  );
  await page.goto(`${server.baseUrl}/viewport-two-metas.html`);
  await page.waitForFunction(() => !!window["jitsu"]);
  await page.evaluate(() => window["jitsu"].track("warm-before-second-meta"));
  await page.waitForTimeout(300);
  const live = await page.evaluate(async () => {
    // the browser applies the later tag; the first one is left as it was
    const later = document.createElement("meta");
    later.name = "viewport";
    later.content = "width=800";
    document.head.append(later);
    const width = window.innerWidth;
    await window["jitsu"].group("second-meta-same-task");
    return width;
  });
  expect(live).toBeGreaterThan(600);
  expect(requestLog.find(entry => entry.body.groupId === "second-meta-same-task")?.body.context.screen.innerWidth).toBe(
    live
  );
  await context.close();
});

for (const [label, name] of [
  ["lowercase name", "viewport"],
  ["capitalised name", "Viewport"],
] as const) {
  test(`a send in the same task as a viewport meta tag added to the body reports the new viewport (${label})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"], ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.route("**/viewport-body-meta.html", route =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><meta name="viewport" content="width=400"><title>Body meta</title><body><script src="/p.js" data-init-only="true"></script>',
      })
    );
    await page.goto(`${server.baseUrl}/viewport-body-meta.html`);
    await page.waitForFunction(() => !!window["jitsu"]);
    await page.evaluate(() => window["jitsu"].track("warm-before-body-meta"));
    await page.waitForTimeout(300);
    const groupId = `body-meta-${name}`;
    const live = await page.evaluate(
      async ([metaName, id]) => {
        // the browser applies viewport tags wherever they sit in the document, and the name is case-insensitive
        const later = document.createElement("meta");
        later.setAttribute("name", metaName);
        later.setAttribute("content", "width=800");
        document.body.append(later);
        const width = window.innerWidth;
        await window["jitsu"].group(id);
        return width;
      },
      [name, groupId]
    );
    expect(live).toBeGreaterThan(600);
    expect(requestLog.find(entry => entry.body.groupId === groupId)?.body.context.screen.innerWidth).toBe(live);
    await context.close();
  });
}

test("a send after viewport content moves between meta tags reports the new viewport", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.route("**/viewport-boundary.html", route =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta name="viewport" content="width=800,initial-scale=1"><title>Boundary</title><script src="/p.js" data-init-only="true" defer></script>',
    })
  );
  await page.goto(`${server.baseUrl}/viewport-boundary.html`);
  await page.waitForFunction(() => !!window["jitsu"]);
  await page.evaluate(() => window["jitsu"].track("warm-before-boundary"));
  await page.waitForTimeout(300);
  const live = await page.evaluate(async () => {
    const before = window.innerWidth;
    // the same words in a different arrangement: one tag becomes two. Joined with a comma they look identical
    document.querySelector('meta[name="viewport"]')!.setAttribute("content", "width=800");
    const second = document.createElement("meta");
    second.name = "viewport";
    second.content = "initial-scale=1";
    document.head.append(second);
    const after = window.innerWidth;
    await window["jitsu"].group("boundary-same-task");
    return { before, after };
  });
  // the browser applies the last tag, so the arrangement changes the viewport
  expect(live.after).not.toBe(live.before);
  expect(requestLog.find(entry => entry.body.groupId === "boundary-same-task")?.body.context.screen.innerWidth).toBe(
    live.after
  );
  await context.close();
});

// A named element can shadow methods of document (DOM clobbering). The viewport cache is an optimisation, so a page
// like that must still get its events.
for (const [tag, method] of [
  ["form", "addEventListener"],
  ["img", "addEventListener"],
  ["form", "getElementsByTagName"],
  ["img", "getElementsByTagName"],
] as const) {
  test(`events are still delivered when ${
    tag === "img" ? "an" : "a"
  } ${tag} named ${method} shadows a document method`, async ({ page }) => {
    const element = tag === "img" ? `<img name="${method}">` : `<form name="${method}"></form>`;
    await page.route("**/viewport-clobbered.html", route =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>Clobbered</title><body>${element}<script src="/p.js" data-init-only="true"></script>`,
      })
    );
    await page.goto(`${server.baseUrl}/viewport-clobbered.html`);
    await page.waitForFunction(() => !!window["jitsu"]);
    expect(await page.evaluate(name => typeof document[name], method)).not.toBe("function");
    const groupId = `clobbered-${tag}-${method}`;
    const outcome = await page.evaluate(
      id =>
        Promise.race([
          window["jitsu"].group(id).then(() => "settled"),
          new Promise(resolve => setTimeout(() => resolve("did not settle in 5 s"), 5000)),
        ]),
      groupId
    );
    expect(outcome).toBe("settled");
    expect(requestLog.find(entry => entry.body.groupId === groupId)).toBeTruthy();
  });
}

// Counts what the viewport cache installs on the page: window resize listeners and MutationObservers
async function countCacheInstalls(page: Page) {
  await page.addInitScript(() => {
    window["installs"] = { resize: 0, observers: 0 };
    const addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type: string, ...rest: any[]) {
      if (type === "resize" && (this === window || this === window.visualViewport)) window["installs"].resize++;
      return (addEventListener as any).call(this, type, ...rest);
    };
    const NativeObserver = window.MutationObserver;
    window.MutationObserver = class extends NativeObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        window["installs"].observers++;
      }
    };
  });
}

const sendAfterDomChanges = (page: Page, sends: number) =>
  page.evaluate(async sends => {
    for (let i = 0; i < sends; i++) {
      document.body.style.padding = `${i + 1}px`;
      await window["jitsu"].group(`viewport-flag-${i}`);
    }
  }, sends);

async function expectCacheOff(page: Page) {
  // past the start-up measurement and its quiet period, which a cache that is on would already have made
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window["viewportReads"])).toEqual({ innerWidth: 0, innerHeight: 0 });
  await sendAfterDomChanges(page, 3);
  expect(await page.evaluate(() => window["viewportReads"])).toEqual({ innerWidth: 3, innerHeight: 3 });
  expect(await page.evaluate(() => window["installs"])).toEqual({ resize: 0, observers: 0 });
}

test("the viewport cache is installed, and warm, unless it is switched off", async ({ page }) => {
  await countCacheInstalls(page);
  await openViewportTestPage(page);
  await page.waitForFunction(() => window["viewportReads"].innerWidth === 1);
  const warm = await page.evaluate(() => ({ ...window["viewportReads"] }));
  await sendAfterDomChanges(page, 3);
  expect(await page.evaluate(() => window["viewportReads"])).toEqual(warm);
  const installs = await page.evaluate(() => window["installs"]);
  expect(installs.resize).toBeGreaterThan(0);
  expect(installs.observers).toBeGreaterThan(0);
});

test('data-disable-viewport-cache="true" reads live and installs nothing', async ({ page }) => {
  await countCacheInstalls(page);
  await openViewportTestPage(page, 'data-disable-viewport-cache="true"');
  await expectCacheOff(page);
});

test('data-disable-viewport-cache="false" leaves the cache on', async ({ page }) => {
  // the attribute arrives as a string, and the string "false" is truthy unless the option has a boolean parser
  await countCacheInstalls(page);
  await openViewportTestPage(page, 'data-disable-viewport-cache="false"');
  await page.waitForFunction(() => window["viewportReads"].innerWidth === 1);
  const warm = await page.evaluate(() => ({ ...window["viewportReads"] }));
  await sendAfterDomChanges(page, 3);
  expect(await page.evaluate(() => window["viewportReads"])).toEqual(warm);
  expect((await page.evaluate(() => window["installs"])).resize).toBeGreaterThan(0);
});

test("disableViewportCache in window.jitsuConfig reads live and installs nothing", async ({ page }) => {
  await countCacheInstalls(page);
  await page.addInitScript(() => {
    window["jitsuConfig"] = { disableViewportCache: true };
  });
  await openViewportTestPage(page);
  await expectCacheOff(page);
});

test("page() reads the viewport live when the cache is switched off", async ({ page }) => {
  await openViewportTestPage(page, 'data-disable-viewport-cache="true"');
  await page.evaluate(() => window["jitsu"].page());
  // analytics.js reads each size for the page properties, and the screen context reads each once more
  expect(await page.evaluate(() => window["viewportReads"])).toEqual({ innerWidth: 2, innerHeight: 2 });
});

// analytics.js reads document.title before window.innerWidth. When that read throws, the cached sizes are never read,
// so the `finally` in withCachedViewport is the only thing that puts the window's own getters back.
test("page() puts window.innerWidth and innerHeight back when analytics.js fails before reading them", async ({
  page,
}) => {
  await openViewportTestPage(page);
  const result = await page.evaluate(async () => {
    const getters = () => ["innerWidth", "innerHeight"].map(key => Object.getOwnPropertyDescriptor(window, key)!.get);
    const before = getters();
    Object.defineProperty(document, "title", {
      configurable: true,
      get() {
        throw new Error("boom");
      },
    });
    let failure = "none";
    try {
      await window["jitsu"].page();
    } catch (e: any) {
      failure = e.message;
    } finally {
      delete (document as any).title;
    }
    const after = getters();
    return { failure, restored: before.every((getter, i) => getter === after[i]), width: typeof window.innerWidth };
  });
  expect(result).toEqual({ failure: "boom", restored: true, width: "number" });
});

// analytics.js has read both sizes, and the window's own getters are back, before it runs any pageStart listener. A
// listener that throws therefore finds nothing left to restore, so this passes without the `finally` too. It guards
// what a plugin sees and what is left behind, for the day analytics.js changes the order of those steps.
test("page() leaves the window as it found it when a pageStart listener throws", async ({ page }) => {
  await openViewportTestPage(page);
  const result = await page.evaluate(async () => {
    const getters = () => ["innerWidth", "innerHeight"].map(key => Object.getOwnPropertyDescriptor(window, key)!.get);
    const before = getters();
    let seenByListener: boolean[] | undefined;
    const unsubscribe = window["jitsu"].on("pageStart", () => {
      seenByListener = getters().map((getter, i) => getter === before[i]);
      throw new Error("plugin boom");
    });
    let failure = "none";
    try {
      await window["jitsu"].page();
    } catch (e: any) {
      failure = e.message;
    } finally {
      unsubscribe();
    }
    return { failure, seenByListener, restored: getters().every((getter, i) => getter === before[i]) };
  });
  expect(result).toEqual({ failure: "plugin boom", seenByListener: [true, true], restored: true });
});

test("page() returns a rejected promise, as before, when reading the viewport throws", async ({ page }) => {
  await openViewportTestPage(page);
  const outcome = await page.evaluate(async () => {
    const real = Object.getOwnPropertyDescriptor(window, "innerWidth")!;
    window.dispatchEvent(new Event("resize")); // empties the cache, so the next call has to read the window
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      get() {
        throw new Error("getter boom");
      },
    });
    let returned: Promise<unknown> | undefined;
    let thrown: string | undefined;
    try {
      returned = window["jitsu"].page();
    } catch (e: any) {
      thrown = e.message;
    } finally {
      // before the SDK's re-measurement timer fires
      Object.defineProperty(window, "innerWidth", real);
    }
    if (thrown) return { kind: "threw synchronously", message: thrown };
    try {
      await returned;
      return { kind: "resolved" };
    } catch (e: any) {
      return { kind: "rejected", message: e.message };
    }
  });
  expect(outcome).toEqual({ kind: "rejected", message: "getter boom" });
});

test("a window that keeps throwing on read raises no error from the SDK's own timer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openViewportTestPage(page);
  await page.waitForFunction(() => window["viewportReads"].innerWidth === 1);
  await page.evaluate(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      get() {
        throw new Error("getter boom");
      },
    });
    window.dispatchEvent(new Event("resize"));
  });
  // past the quiet period, a rendered frame and the task after it, when the SDK measures again
  await page.waitForTimeout(500);
  expect(errors.filter(message => message.includes("getter boom"))).toEqual([]);
});

test("page() rejects, and sends nothing, when the viewport read fails and a later read would succeed", async ({
  page,
}) => {
  await openViewportTestPage(page);
  const outcome = await page.evaluate(async () => {
    const real = Object.getOwnPropertyDescriptor(window, "innerWidth")!;
    let pageStarts = 0;
    const unsubscribe = window["jitsu"].on("pageStart", () => pageStarts++);
    window.dispatchEvent(new Event("resize")); // empties the cache, so the next call has to read the window
    let reads = 0;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      get() {
        // fails on the first two reads, the SDK's cache attempt and its live fallback, then works
        if (++reads <= 2) throw new Error(`getter boom #${reads}`);
        return real.get!.call(window);
      },
    });
    let result: string;
    try {
      const returned = window["jitsu"].page();
      result = await returned.then(
        () => "resolved",
        (e: any) => `rejected: ${e.message}`
      );
    } catch (e: any) {
      result = `threw synchronously: ${e.message}`;
    } finally {
      Object.defineProperty(window, "innerWidth", real); // before the SDK's re-measurement timer fires
      unsubscribe();
    }
    return { result, pageStarts };
  });
  expect(outcome.result).toMatch(/^rejected: getter boom/);
  expect(outcome.pageStarts).toBe(0);
});

// window.parent is replaceable: a page script that declares `var parent` overwrites it. window.top is not.
test("an iframe whose own script replaces window.parent still reports its live size", async ({ page }) => {
  await page.route("**/viewport-parent-null.html", route =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Frame</title><body><script>var parent = null;</script><script src="/p.js" data-init-only="true"></script>',
    })
  );
  await page.goto(`${server.baseUrl}/basic.html`);
  const live = await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    frame.width = "800";
    frame.height = "600";
    frame.src = "/viewport-parent-null.html";
    document.body.append(frame);
    await new Promise(resolve => (frame.onload = () => resolve(undefined)));
    const client = frame.contentWindow!["jitsu"];
    await client.group("parent-null-warm");
    frame.width = "640";
    const width = frame.contentWindow!.innerWidth;
    await client.group("parent-null-shrunk");
    return width;
  });
  expect(live).toBe(640);
  expect(requestLog.find(entry => entry.body.groupId === "parent-null-shrunk")?.body.context.screen.innerWidth).toBe(
    live
  );
});

test("a top-level page whose script replaces window.parent still uses the cache", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  // the same effect as `var parent = document.createElement("div")` in a page script
  await page.addInitScript(() => {
    window["parent"] = document.createElement("div") as any;
  });
  await openViewportTestPage(page);
  await page.waitForFunction(() => window["viewportReads"].innerWidth === 1);
  const warm = await page.evaluate(() => ({ ...window["viewportReads"] }));
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      document.body.style.padding = `${i + 1}px`;
      await window["jitsu"].group(`parent-replaced-${i}`);
    }
  });
  expect(await page.evaluate(() => window["viewportReads"])).toEqual(warm);
});

test("an iframe makes no viewport reads until it sends", async ({ page }) => {
  await openViewportTestPage(page);
  await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    frame.src = "/viewport-test.html";
    document.body.append(frame);
    await new Promise(resolve => (frame.onload = () => resolve(undefined)));
  });
  const frame = page.frames().find(candidate => candidate !== page.mainFrame())!;
  await frame.waitForFunction(() => !!window["jitsu"]);
  // longer than the quiet period plus a frame, with nothing sent
  await page.waitForTimeout(500);
  // a frame always reads live and keeps nothing, so a start-up measurement there would be wasted
  expect(await frame.evaluate(() => window["viewportReads"])).toEqual({ innerWidth: 0, innerHeight: 0 });
  await frame.evaluate(() => window["jitsu"].group("first-send-in-frame"));
  expect(await frame.evaluate(() => window["viewportReads"])).toEqual({ innerWidth: 1, innerHeight: 1 });
});

test("a burst of resizes is measured once, after it ends", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openViewportTestPage(page);
  await page.evaluate(() => window["jitsu"].group("warm-before-burst"));
  await page.waitForTimeout(400);
  const warm = await page.evaluate(() => ({ ...window["viewportReads"] }));
  // a drag: a new size every few milliseconds
  for (let i = 0; i < 12; i++) {
    await page.setViewportSize({ width: 600 + 10 * i, height: 500 });
    await page.waitForTimeout(8);
  }
  await page.waitForFunction(before => window["viewportReads"].innerWidth > before, warm.innerWidth);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ ...window["viewportReads"] }));
  expect(after.innerWidth - warm.innerWidth).toBe(1);
  expect(after.innerHeight - warm.innerHeight).toBe(1);
  await page.evaluate(() => window["jitsu"].group("after-burst"));
  expect(await page.evaluate(() => window["viewportReads"])).toEqual(after);
  expect(requestLog.find(entry => entry.body.groupId === "after-burst")?.body.context.screen).toMatchObject({
    innerWidth: 710,
    innerHeight: 500,
  });
});

test("page reads no dimensions with a warm cache and still reports the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openViewportTestPage(page);
  await page.evaluate(() => window["jitsu"].track("warm-before-page"));
  const warm = await page.evaluate(() => ({ ...window["viewportReads"] }));
  await page.evaluate(async () => {
    await window["jitsu"].page({ caseName: "viewport-page-default" });
    await window["jitsu"].page({ width: 123, height: 456, caseName: "viewport-page-explicit" });
  });
  // analytics.js reads the window inside page(); the SDK serves it from the cache instead
  expect(await page.evaluate(() => window["viewportReads"])).toEqual(warm);
  const propertiesOf = (caseName: string) =>
    requestLog.find(entry => entry.body.properties?.caseName === caseName)?.body.properties;
  expect(propertiesOf("viewport-page-default")).toMatchObject({ width: 800, height: 600 });
  expect(propertiesOf("viewport-page-explicit")).toMatchObject({ width: 123, height: 456 });

  // the replacement getters never outlive the call: the original (instrumented) ones are back
  const outside = await page.evaluate(() => {
    const before = window["viewportReads"].innerWidth;
    void window.innerWidth;
    return window["viewportReads"].innerWidth - before;
  });
  expect(outside).toBe(1);

  // a real resize invalidates the cache, so the next page() reports the new size
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await page.evaluate(() => window["jitsu"].page({ caseName: "viewport-page-resized" }));
  expect(propertiesOf("viewport-page-resized")).toMatchObject({ width: 640, height: 480 });
});

test("page(name, props) takes one consistent measurement even if a property getter reads the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openViewportTestPage(page);
  await page.evaluate(() => window["jitsu"].track("warm-before-named-page"));
  await page.evaluate(async () => {
    await window["jitsu"].page("named", {
      caseName: "viewport-named-getter",
      get probe() {
        // the viewport changes while the caller's properties are being read
        window["viewportOverride"] = { innerWidth: 640 };
        return window.innerWidth;
      },
    });
  });
  const sent = requestLog.find(entry => entry.body.properties?.caseName === "viewport-named-getter")?.body;
  // analytics.js and the SDK must agree: both come from the cached 800x600 measurement, not a 640x600 mix
  expect(sent.properties).toMatchObject({ width: 800, height: 600 });
  expect(sent.context.screen).toMatchObject({ innerWidth: 800, innerHeight: 600 });
});

test("listeners run by analytics.js during page() see the real viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openViewportTestPage(page);
  await page.evaluate(() => window["jitsu"].track("warm-before-listener"));
  const listener = await page.evaluate(async () => {
    const seen: { hitRealGetter?: boolean } = {};
    window["jitsu"].on("pageStart", () => {
      const before = window["viewportReads"].innerWidth;
      void window.innerWidth;
      seen.hitRealGetter = window["viewportReads"].innerWidth - before === 1;
    });
    await window["jitsu"].page({ caseName: "viewport-page-listener" });
    return seen;
  });
  // the SDK's cached replacement must be gone by the time pageStart listeners run
  expect(listener.hitRealGetter).toBe(true);
});

test("multiple sends in a native resize handler share a single measurement", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openViewportTestPage(page);
  await page.evaluate(async () => {
    await window["jitsu"].group("before-native-resize");
    window["nativeResizeReads"] = new Promise(resolve => {
      window.addEventListener(
        "resize",
        () => {
          const before = { ...window["viewportReads"] };
          for (let i = 0; i < 3; i++) {
            document.body.style.padding = `${i + 1}px`;
            window["jitsu"].group("during-native-resize");
          }
          resolve([
            window["viewportReads"].innerWidth - before.innerWidth,
            window["viewportReads"].innerHeight - before.innerHeight,
          ]);
        },
        { once: true }
      );
    });
  });
  await page.setViewportSize({ width: 640, height: 480 });
  expect(await page.evaluate(() => window["nativeResizeReads"])).toEqual([1, 1]);
});

for (const firstSend of ["before navigation", "during pagehide"] as const) {
  test(`an early pageshow send measures the restored viewport (first send ${firstSend})`, async ({ page }) => {
    clearRequestLog();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.addInitScript(firstSend => {
      if (location.pathname !== "/viewport-history.html") return;
      window.addEventListener(
        "pageshow",
        event => {
          if (event.persisted) window["jitsu"].group("restored-from-history");
        },
        true
      );
      if (firstSend === "during pagehide") {
        window.addEventListener("pagehide", () => window["jitsu"].group("before-history"), true);
      }
    }, firstSend);
    await page.goto(`${server.baseUrl}/viewport-history.html`);
    // survives a back-forward cache restore, gone after a reload
    await page.evaluate(() => (window["bfcacheMarker"] = true));
    if (firstSend === "before navigation") {
      await page.evaluate(() => window["jitsu"].group("before-history"));
    }
    await page.goto(`${server.baseUrl}/p.js`);
    await page.setViewportSize({ width: 640, height: 480 });
    await page.evaluate(() => history.back());
    // a restore from the back-forward cache fires no load event
    await page.waitForURL(`${server.baseUrl}/viewport-history.html`, { waitUntil: "commit" });
    // Chromium Headless Shell (the browser CI installs) never restores from the back-forward cache,
    // so there is no restored page to observe there. Full Chrome and Chromium do.
    const restoredFromCache = await page.evaluate(() => window["bfcacheMarker"] === true);
    test.skip(!restoredFromCache, "the browser did not restore the page from the back-forward cache");
    await expect
      .poll(() => requestLog.find(entry => entry.body.groupId === "restored-from-history")?.body.context.screen)
      .toMatchObject({ innerWidth: 640, innerHeight: 480 });
  });
}

test("redispatching a native resize reads the current viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openViewportTestPage(page);
  await page.evaluate(async () => {
    await window["jitsu"].group("before-redispatch");
    const viewport = window.visualViewport!;
    viewport.addEventListener(
      "resize",
      event => {
        if (!event.isTrusted) return;
        window["jitsu"].group("native-before-redispatch");
        // Redispatch after the native handler returns, before another resize is delivered.
        setTimeout(() => {
          Object.defineProperty(window, "innerWidth", { configurable: true, value: 720 });
          viewport.dispatchEvent(event);
          window["jitsu"].group("after-redispatch");
        }, 0);
      },
      { once: true }
    );
  });
  await page.setViewportSize({ width: 640, height: 480 });
  await expect
    .poll(() => requestLog.find(entry => entry.body.groupId === "after-redispatch")?.body.context.screen.innerWidth)
    .toBe(720);
});

for (const capture of [false, true]) {
  test(`resize handler registered before SDK initialization sees the new viewport (capture=${capture})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.addInitScript(capture => {
      window.addEventListener(
        "resize",
        () => {
          if (window.innerWidth === 640) window["jitsu"].page({ caseName: "early-resize-handler" });
        },
        capture
      );
    }, capture);
    await page.goto(`${server.baseUrl}/basic.html`);
    const sent = page.waitForRequest(
      req => req.url().endsWith("/api/s/page") && req.postDataJSON()?.properties?.caseName === "early-resize-handler"
    );
    await page.setViewportSize({ width: 640, height: 480 });
    const payload = (await sent).postDataJSON();
    expect(payload.properties).toMatchObject({ width: 640, height: 480 });
    expect(payload.context.screen).toMatchObject({ innerWidth: 640, innerHeight: 480 });
  });
}

test("a host can resize an iframe and send before resize notification", async ({ page }) => {
  await page.goto(`${server.baseUrl}/basic.html`);
  await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    frame.width = "800";
    frame.height = "600";
    frame.src = "/basic.html";
    const loaded = new Promise<void>(resolve => {
      frame.onload = () => resolve();
    });
    document.body.append(frame);
    await loaded;
    const client = frame.contentWindow!["jitsu"];
    await client.group("iframe-ready");
    // Warm the cache and send the page view in the same task as the resize.
    const warm = client.group("iframe-before-resize");
    frame.width = "720";
    await Promise.all([warm, client.page({ caseName: "synchronous-frame-resize" })]);
  });
  const resized = requestLog.find(entry => entry.body.properties?.caseName === "synchronous-frame-resize")?.body;
  expect(resized?.properties).toMatchObject({ width: 720, height: 600 });
  expect(resized?.context.screen).toMatchObject({ innerWidth: 720, innerHeight: 600 });
});

test("an iframe client follows its first same-origin navigation", async ({ page }) => {
  let releaseNavigation: () => void;
  const initialized = new Promise<void>(resolve => {
    releaseNavigation = resolve;
  });
  await page.exposeFunction("frameReady", () => releaseNavigation());
  await page.route("**/viewport-frame.html", async route => {
    await initialized;
    await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Frame</title>" });
  });
  await page.goto(`${server.baseUrl}/basic.html`);
  await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    frame.width = "800";
    frame.height = "600";
    const loaded = new Promise<void>(resolve => {
      frame.onload = () => resolve();
    });
    frame.src = "/viewport-frame.html";
    document.body.append(frame);
    const initial = frame.contentDocument!;
    const script = initial.createElement("script");
    script.src = new URL("/p.js", location.href).href;
    const ready = new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load iframe SDK"));
    });
    initial.head.append(script);
    await ready;
    const client = frame.contentWindow!["jitsu"];
    await client.group("before-frame-navigation");

    await window["frameReady"]();
    await loaded;
    if (frame.contentDocument === initial || frame.contentWindow!["jitsu"] !== client) {
      throw new Error("Expected a new document with the original SDK");
    }
    frame.width = "640";
    await client.group("after-frame-navigation");

    const doc = frame.contentDocument!;
    doc.open();
    doc.write("<!doctype html><title>Rewritten</title>");
    doc.close();
    frame.width = "700";
    await client.group("after-frame-rewrite");
  });
  for (const [groupId, width] of [
    ["before-frame-navigation", 800],
    ["after-frame-navigation", 640],
    ["after-frame-rewrite", 700],
  ] as const) {
    expect(requestLog.find(entry => entry.body.groupId === groupId)?.body.context.screen).toMatchObject({
      innerWidth: width,
      innerHeight: 600,
    });
  }
});

for (const reuseRoot of [false, true]) {
  test(`an existing client tracks viewport changes after document.open() (reuse root: ${reuseRoot})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`${server.baseUrl}/basic.html`);
    await page.evaluate(reuseRoot => {
      const original = document.documentElement;
      document.open();
      document.write("<!doctype html><title>Rewritten document</title>");
      document.close();
      if (reuseRoot) document.replaceChild(original, document.documentElement);
    }, reuseRoot);
    for (const width of [640, 700]) {
      await page.setViewportSize({ width, height: 480 });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      await page.evaluate(() => window["jitsu"].track("rewritten-viewport"));
      expect(
        requestLog.filter(entry => entry.body.event === "rewritten-viewport").at(-1)?.body.context.screen
      ).toMatchObject({ innerWidth: width, innerHeight: 480 });
    }
  });
}

test("restoring the original document root keeps the current viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(`${server.baseUrl}/basic.html`);
  await page.evaluate(() => {
    const original = document.documentElement;
    document.replaceChild(original.cloneNode(false), original);
    window["restoreRoot"] = () => document.replaceChild(original, document.documentElement);
  });
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await page.evaluate(() => {
    window["restoreRoot"]();
    return window["jitsu"].track("restored-root");
  });
  expect(requestLog.find(entry => entry.body.event === "restored-root")?.body.context.screen).toMatchObject({
    innerWidth: 640,
    innerHeight: 480,
  });
});

for (const earlySender of ["absent", "sends", "stops"] as const) {
  test(`sends inside synthetic resize handlers read live dimensions (early sender: ${earlySender})`, async ({
    page,
  }) => {
    clearRequestLog();
    await page.addInitScript(earlySender => {
      if (earlySender === "absent") return;
      window.addEventListener(
        "resize",
        event => {
          if (event.isTrusted) return;
          window["sendGroups"]("early");
          if (earlySender === "stops") event.stopImmediatePropagation();
        },
        true
      );
    }, earlySender);
    await page.goto(`${server.baseUrl}/basic.html`);
    const reads = await page.evaluate(async earlySender => {
      let widthReads = 0;
      let width = 800;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        get() {
          widthReads++;
          return width;
        },
      });
      const sent: Promise<unknown>[] = [];
      window["sendGroups"] = (phase: string) => {
        for (let i = 0; i < 3; i++) sent.push(window["jitsu"].group(`synthetic-${width}-${phase}`));
      };
      window.addEventListener("resize", event => {
        if (!event.isTrusted) window["sendGroups"]("late");
      });
      const resize = new Event("resize");
      window.dispatchEvent(resize);
      const first = widthReads;
      width = 640;
      if (earlySender === "stops") resize.initEvent("resize", false, false);
      window.dispatchEvent(resize);
      const second = widthReads - first;
      await Promise.all(sent);
      return [first, second];
    }, earlySender);
    const sends = earlySender === "sends" ? 6 : 3;
    expect(reads).toEqual([sends, sends]);
    for (const width of [800, 640]) {
      for (const phase of ["early", "late"]) {
        if (phase === "early" && earlySender === "absent") continue;
        if (phase === "late" && earlySender === "stops") continue;
        const events = requestLog.filter(entry => entry.body.groupId === `synthetic-${width}-${phase}`);
        expect(events.map(entry => entry.body.context.screen.innerWidth)).toEqual([width, width, width]);
      }
    }
  });
}

test("basic", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  await browserContext.addCookies([
    { name: "_fbc", value: "fbc-id", url: server.baseUrl },
    { name: "_fbp", value: "fbp-id", url: server.baseUrl },
    { name: "_ttp", value: "ttp-id", url: server.baseUrl },
  ]);

  const { page: firstPage, uncaughtErrors: firstPageErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([
    firstPage.goto(`${server.baseUrl}/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign`),
  ]);

  await firstPage.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult.status()).toBe(200);
  const cookies = (await browserContext.cookies()).reduce(
    (res, cookie) => ({
      ...res,
      [cookie.name]: cookie.value,
    }),
    {}
  );
  console.log("🍪 Jitsu Cookies", cookies);
  //wait for some time since the server has an artificial latency of 30ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(firstPageErrors.length).toEqual(0);
  const anonymousId = cookies["__eventn_id"];
  expect(anonymousId).toBeDefined();
  expect(cookies["__eventn_uid"]).toBe("john-doe-id-1");
  expect(cookies["__eventn_id_usr"]).toBeDefined();
  expect(JSON.parse(decodeURIComponent(cookies["__eventn_id_usr"])).email).toEqual("john.doe@gmail.com");
  console.log(
    `📝 Request log size of ${requestLog.length}`,
    requestLog.map(x => describeEvent(x.type, x.body))
  );
  let identifies = requestLog.filter(x => x.type === "identify");
  let pages = requestLog.filter(x => x.type === "page");
  let tracks = requestLog.filter(x => x.type === "track");
  expect(identifies.length).toBe(1);
  expect(pages.length).toBe(1);
  expect(tracks.length).toBe(1);

  const track = tracks[0].body as AnalyticsClientEvent;
  const page = pages[0].body as AnalyticsClientEvent;
  const identify = identifies[0].body as AnalyticsClientEvent;

  console.log(chalk.bold("📝 Checking track event"), JSON.stringify(track, null, 3));
  expect(track.properties.trackParam).toEqual("trackValue");
  expect(track.type).toEqual("track");
  expect(track.context.clientIds).toHaveProperty("fbc", "fbc-id");
  expect(track.context.clientIds).toHaveProperty("fbp", "fbp-id");
  expect(track.context.clientIds).toHaveProperty("ttp", "ttp-id");
  expect(track.context.traits.email).toEqual("john.doe@gmail.com");
  expect(track.userId).toEqual("john-doe-id-1");
  expect(track.event).toEqual("pageLoaded");

  console.log(chalk.bold("📝 Checking identify event"), JSON.stringify(identify, null, 3));
  expect(identify.traits.email).toEqual("john.doe@gmail.com");
  expect(identify.userId).toEqual("john-doe-id-1");
  expect(identify.anonymousId).toEqual(anonymousId);

  console.log(chalk.bold("📝 Checking page event"), JSON.stringify(page, null, 3));
  expect(page.anonymousId).toEqual(anonymousId);
  expect(page.context.clientIds).toHaveProperty("fbc", "fbc-id");
  expect(page.context.clientIds).toHaveProperty("fbp", "fbp-id");
  expect(page.context.clientIds).toHaveProperty("ttp", "ttp-id");
  expect(page.context.traits.email).toEqual("john.doe@gmail.com");
  expect(page.userId).toEqual("john-doe-id-1");

  expect(page.context.campaign.source).toEqual("source");

  const { page: secondPage, uncaughtErrors: secondPageErrors } = await createLoggingPage(browserContext);
  await secondPage.goto(`${server.baseUrl}/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign`);
  await secondPage.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  clearRequestLog();

  await secondPage.evaluate(generateTestEvents);
  expect(secondPageErrors.length).toBe(0);
  let counter = 1;
  requestLog.forEach(({ body: payload }) => {
    const dir = path.join(__dirname, "artifacts", "requests");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(
      dir,
      `${counter++} - ${payload.traits?.caseName || payload.properties?.caseName || payload.context?.caseName}.json`
    );
    fs.writeFileSync(file, JSON.stringify(sortKeysRecursively(payload), null, 2));
  });
});

test("ga4_cookies", async ({ browser }) => {
  clearRequestLog();
  const browserContext = await browser.newContext();
  await browserContext.addCookies([
    // client id cookie
    { name: "_ga", value: "GA1.1.808865741.1700468121", url: server.baseUrl },
    // old session id cookies
    { name: "_ga_OLDDEFGHI1", value: "GS1.1.1711045472.9.0.1711045472.0.0.0", url: server.baseUrl },
    // new session id cookies
    { name: "_ga_NEWDEFGHI2", value: "GS2.1.s1756461685$o733$g1$t1756461704$j41$l0$h0", url: server.baseUrl },
    { name: "_ga_NEWDEFGHI3", value: "GS2.1.o733$g1$t1756461704$j41$l0$h0$s1756461686", url: server.baseUrl },
  ]);

  const { page: firstPage, uncaughtErrors: firstPageErrors } = await createLoggingPage(browserContext);
  const [pageResult] = await Promise.all([
    firstPage.goto(`${server.baseUrl}/basic.html?utm_source=source&utm_medium=medium&utm_campaign=campaign`),
  ]);

  await firstPage.waitForFunction(() => window["jitsu"] !== undefined, undefined, {
    timeout: 1000,
    polling: 100,
  });
  expect(pageResult.status()).toBe(200);
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log(
    `📝 Request log size of ${requestLog.length}`,
    requestLog.map(x => describeEvent(x.type, x.body))
  );
  let pages = requestLog.filter(x => x.type === "page");
  expect(pages.length).toBe(1);

  const page = pages[0].body as AnalyticsClientEvent;

  console.log(chalk.bold("📝 Checking page event"), JSON.stringify(page, null, 3));
  expect(page.context.clientIds.ga4.clientId).toBe("808865741.1700468121");
  expect(page.context.clientIds.ga4.sessionIds).toHaveProperty("OLDDEFGHI1", "1711045472");
  expect(page.context.clientIds.ga4.sessionIds).toHaveProperty("NEWDEFGHI2", "1756461685");
  expect(page.context.clientIds.ga4.sessionIds).toHaveProperty("NEWDEFGHI3", "1756461686");
});
