import { generateKeyPairSync } from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { testJitsuFunction } from "./lib/testing-lib";
import WebhookDestination from "../src/functions/webhook-destination";
import { WebhookDestinationConfig } from "../src/meta";
import { signatureHeaders } from "../src/functions/webhook/signing";

// The Reverse ETL webhook signs with its own copy of the event webhook's signing code. These tests run the real event
// webhook function and require the Reverse ETL helper to produce byte-identical signature headers for the same body,
// key and timestamp, so the two cannot drift apart unnoticed. Extraction into one helper is deferred (JITSU-242, WP0c).
const url = "http://webhook.test.local/hook";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function eventWebhookRequest(config: Partial<WebhookDestinationConfig>) {
  let captured: { headers: Record<string, string>; body: string } | undefined;
  server.use(
    http.post(url, async ({ request }) => {
      captured = { headers: Object.fromEntries(request.headers.entries()), body: await request.text() };
      return HttpResponse.text("ok");
    })
  );
  await testJitsuFunction<WebhookDestinationConfig>({
    func: WebhookDestination,
    config: { url, method: "POST", ...config } as WebhookDestinationConfig,
    events: [{ type: "track", event: "test_event", messageId: "m1" } as AnalyticsServerEvent],
  });
  if (!captured) throw new Error("webhook was never called");
  return captured;
}

const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const bare = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");

const cases: Array<[string, Partial<WebhookDestinationConfig>]> = [
  ["hmac with timestamp", { signatureMethod: "hmac", signatureSecret: "s3cret" }],
  ["hmac without timestamp", { signatureMethod: "hmac", signatureSecret: "s3cret", signatureIncludeTimestamp: false }],
  ["hmac, custom header", { signatureMethod: "hmac", signatureSecret: "s3cret", signatureHeader: "X-My-Sig" }],
  ["ed25519, PEM key", { signatureMethod: "ed25519", signaturePrivateKey: pem }],
  ["ed25519, bare base64 key", { signatureMethod: "ed25519", signaturePrivateKey: bare }],
  [
    "ed25519 without timestamp, custom header",
    {
      signatureMethod: "ed25519",
      signaturePrivateKey: pem,
      signatureHeader: "X-Ed",
      signatureIncludeTimestamp: false,
    },
  ],
];

describe("Reverse ETL signing matches the event webhook", () => {
  test.each(cases)("%s", async (_name, config) => {
    const sent = await eventWebhookRequest(config);
    const header = (config.signatureHeader || "Jitsu-Signature") as string;
    const timestamp = sent.headers[`${header}-Timestamp`.toLowerCase()];
    const ours = signatureHeaders(
      sent.body,
      {
        method: config.signatureMethod as "hmac" | "ed25519",
        secret: config.signatureSecret,
        privateKey: config.signaturePrivateKey,
        header,
        includeTimestamp: config.signatureIncludeTimestamp ?? true,
      },
      timestamp ? Number(timestamp) : undefined
    );
    expect(Object.keys(ours).length).toBe(timestamp ? 2 : 1);
    for (const [name, value] of Object.entries(ours)) expect(sent.headers[name.toLowerCase()]).toBe(value);
  });
});
