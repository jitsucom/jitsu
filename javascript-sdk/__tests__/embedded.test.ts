import { runUrl, TestServer } from "./common/common";
import { chromium, Browser } from "playwright";
/**
 * This test verifies that Jitsu SDK with HTML embedding.
 */

const server = new TestServer();
let browser: Browser;
jest.setTimeout(10_000);

beforeAll(async () => {
  await server.init();
  browser = await chromium.launch();
});

test("lib.js accessible", async () => {
  await runUrl(browser, server.getUrl("/s/lib.js"));
});

test("test embedded no init", async () => {
  server.clearRequestLog();
  const pageResult = await runUrl(
    browser,
    server.getUrl("/test-case/embed-no-init.html?gclid=1")
  );
  expect(pageResult.consoleErrors.length).toBe(0);
  let requestLog = server.requestLog;
  expect(requestLog.length).toBe(2);
  expect(requestLog[0].api_key).toBe("Test2");
  expect(requestLog[0].src).toBe("eventn");
  expect(requestLog[0].eventn_ctx.click_id.gclid).toBe("1");
  expect(requestLog[0].eventn_ctx.user.id).toBe("uid");
  expect(requestLog[0].eventn_ctx.user.email).toBe("a@b.com");
  expect(requestLog[0].eventn_ctx.user.anonymous_id).toBe(
    requestLog[1].eventn_ctx.user.anonymous_id
  );
  server.clearRequestLog();
});

test("test segment intercept", async () => {
  server.clearRequestLog();
  const { consoleErrors, allRequests } = await runUrl(
    browser,
    server.getUrl(
      "/test-case/segment-intercept.html?gclid=1&utm_source=UTM-SOURCE"
    )
  );
  expect(consoleErrors.length).toBe(0);
  expect(
    allRequests.filter(
      (req) => req.url().indexOf("https://api.segment.io/v1/") >= 0
    ).length
  ).toBe(server.requestLog.length);
  console.log(
    `Request log (${server.requestLog.length})`,
    JSON.stringify(server.requestLog, null, 2)
  );
  expect(server.requestLog.length).toBe(4);
  server.clearRequestLog();
});

test("test embedded", async () => {
  server.clearRequestLog();
  let pageResult = await runUrl(
    browser,
    server.getUrl("/test-case/embed.html?gclid=1")
  );
  expect(pageResult.consoleErrors.length).toBe(0);
  let requestLog = server.requestLog;
  expect(requestLog.length).toBe(2);
  expect(requestLog[0].api_key).toBe("Test");
  expect(requestLog[0].click_id.gclid).toBe("1");
  expect(requestLog[0].user.anonymous_id).toBeDefined();
  expect(requestLog[0].user.anonymous_id).toBe(requestLog[1].user.anonymous_id);
  expect(requestLog[1].user.anonymous_id).toBeDefined();
  expect(requestLog[1].extra).toBe(1);
  expect(requestLog[1].persistent_prop1).toBe(2);
  expect(requestLog[1].persistent_prop2).toBe(3);
  expect(requestLog[1].persistent_prop3).toBe(undefined);
  server.clearRequestLog();
});

test("test privacy policy", async () => {
  server.clearRequestLog();
  const pageResult = await runUrl(
    browser,
    server.getUrl("/test-case/embed-privacy-policy.html?gclid=1")
  );
  expect(pageResult.consoleErrors.length).toBe(0);
  let requestLog = server.requestLog;
  expect(requestLog.length).toBe(2);
  expect(requestLog[0].api_key).toBe("Test");
  expect(requestLog[0].click_id.gclid).toBe("1");
  expect(requestLog[0].user.anonymous_id).toBe("");
  expect(requestLog[0].user.anonymous_id).toBe(requestLog[1].user.anonymous_id);
  expect(requestLog[1].user.anonymous_id).toBe("");
  expect(requestLog[1].extra).toBe(1);
  expect(requestLog[1].persistent_prop1).toBe(2);
  expect(requestLog[1].persistent_prop2).toBe(3);
  expect(requestLog[1].persistent_prop3).toBe(undefined);
  server.clearRequestLog();
});

test("test tag destination", async () => {
  server.clearRequestLog();
  let pageResult = await runUrl(
    browser,
    server.getUrl("/test-case/embed_tag_destination.html?gclid=1")
  );
  expect(pageResult.consoleErrors.length).toBe(1);
  expect(
    pageResult.consoleErrors.filter((msg) => msg === "EXPECTED_TEST_MESSAGE")
      .length
  ).toBe(1);
  let requestLog = server.requestLog;
  expect(requestLog.length).toBe(1);
  expect(requestLog[0].api_key).toBe("Test");
  expect(requestLog[0].click_id.gclid).toBe("1");
  expect(requestLog[0].user.anonymous_id).toBeDefined();
  expect(requestLog[0].extra).toBe(1);
  expect(requestLog[0].persistent_prop1).toBe(2);
  expect(requestLog[0].persistent_prop2).toBe(3);
  expect(requestLog[0].persistent_prop3).toBe(undefined);
  server.clearRequestLog();
});

afterAll(async () => {
  server.stop();
  await browser.close();
});
