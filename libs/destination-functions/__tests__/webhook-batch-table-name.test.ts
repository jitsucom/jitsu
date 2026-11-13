import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { testJitsuFunction } from "./lib/testing-lib";
import WebhookDestination from "../src/functions/webhook-destination";
import { WebhookDestinationConfig } from "../src/meta";

// BULKER_URL is read when the module loads, so it must be set before the import is evaluated.
vi.hoisted(() => {
  process.env.BULKER_URL = "http://bulker.test.local";
});

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function runBatch(event: Record<string, any>): Promise<{ tableName: string | null; body: any }> {
  let captured: { tableName: string | null; body: any } | undefined;
  server.use(
    http.post("http://bulker.test.local/post/:connectionId", async ({ request }) => {
      captured = {
        tableName: new URL(request.url).searchParams.get("tableName"),
        body: JSON.parse(await request.text()),
      };
      return HttpResponse.text("ok");
    })
  );
  await testJitsuFunction<WebhookDestinationConfig>({
    func: WebhookDestination,
    config: { url: "http://webhook.test.local/hook", method: "POST" } as WebhookDestinationConfig,
    chainCtx: { connectionOptions: { mode: "batch" } } as any,
    ctx: {
      headers: {},
      connection: { id: "conn1" },
      destination: { id: "dest1", type: "webhook", updatedAt: new Date(), hash: "1" },
      source: { id: "src1", type: "browser" },
      workspace: { id: "ws1" },
      receivedAt: new Date(),
    } as any,
    events: [event as AnalyticsServerEvent],
  });
  if (!captured) throw new Error("bulker was never called");
  return captured;
}

test("batch mode: JITSU_TABLE_NAME selects the bulker table and is removed from the payload", async () => {
  const { tableName, body } = await runBatch({
    type: "track",
    event: "button_clicked",
    messageId: "m1",
    JITSU_TABLE_NAME: "my_table",
  });
  expect(tableName).toBe("my_table");
  expect(body.JITSU_TABLE_NAME).toBeUndefined();
  expect(body.event).toBe("button_clicked");
});

test("batch mode: without JITSU_TABLE_NAME the table is still the event name", async () => {
  const { tableName } = await runBatch({ type: "track", event: "button_clicked", messageId: "m2" });
  expect(tableName).toBe("button_clicked");
});
