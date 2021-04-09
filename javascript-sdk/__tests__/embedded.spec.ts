import { runUrl, TestServer } from './common/common';
import { chromium } from 'playwright';
import { Browser } from 'playwright/types/types';

const server = new TestServer();
let browser: Browser;

beforeAll(async () => {
  await server.init();
  browser = await chromium.launch();
});

test('lib.js accessible', async () => {
  await runUrl(browser, server.getUrl('/lib.js'));
});

test('test embedded', async () => {
  await runUrl(browser, server.getUrl('/test-case/embed.html'));
});

afterAll(async () => {
  server.stop();
  await browser.close();
})