import { createHmac, generateKeyPairSync, verify } from "crypto";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { testJitsuFunction } from "./lib/testing-lib";
import WebhookDestination from "../src/functions/webhook-destination";
import { WebhookDestinationConfig } from "../src/meta";

// MSW intercepts the real fetch so we assert on the actual signed request.
const url = "http://webhook.test.local/hook";
const secret = "super-secret-key";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Runs the webhook destination once and returns the signature headers + sent body.
async function sign(
  config: Partial<WebhookDestinationConfig>
): Promise<{ signature: string; timestamp: string | null; body: string }> {
  let captured: { signature: string; timestamp: string | null; body: string } | undefined;
  server.use(
    http.post(url, async ({ request }) => {
      captured = {
        signature: request.headers.get("Jitsu-Signature") ?? "",
        timestamp: request.headers.get("Jitsu-Signature-Timestamp"),
        body: await request.text(),
      };
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

test("hmac: signs timestamp + body and sends a timestamp header by default", async () => {
  const { signature, timestamp, body } = await sign({ signatureMethod: "hmac", signatureSecret: secret });
  expect(timestamp).toMatch(/^\d+$/);
  expect(signature).toBe(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"));
});

test("hmac: signs the body only and omits the timestamp header when replay protection is off", async () => {
  const { signature, timestamp, body } = await sign({
    signatureMethod: "hmac",
    signatureSecret: secret,
    signatureIncludeTimestamp: false,
  });
  expect(timestamp).toBeNull();
  expect(signature).toBe(createHmac("sha256", secret).update(body).digest("hex"));
});

test("ed25519: signature verifies against the public key", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const { signature, timestamp, body } = await sign({
    signatureMethod: "ed25519",
    signaturePrivateKey: privatePem,
  });

  expect(timestamp).toMatch(/^\d+$/);
  const ok = verify(null, Buffer.from(`${timestamp}.${body}`), publicKey, Buffer.from(signature, "hex"));
  expect(ok).toBe(true);
});

test("a signing method with no key configured fails without retrying", async () => {
  server.use(http.post(url, () => HttpResponse.text("ok")));
  await expect(
    testJitsuFunction<WebhookDestinationConfig>({
      func: WebhookDestination,
      config: { url, method: "POST", signatureMethod: "hmac" } as WebhookDestinationConfig,
      events: [{ type: "track", event: "test_event", messageId: "m1" } as AnalyticsServerEvent],
    })
  ).rejects.toMatchObject({ name: "NoRetryError" });
});

test("schema rejects an invalid signature header name", () => {
  expect(
    WebhookDestinationConfig.safeParse({ url: "https://example.com", signatureHeader: "Bad Header" }).success
  ).toBe(false);
  expect(
    WebhookDestinationConfig.safeParse({ url: "https://example.com", signatureHeader: "X-My-Signature" }).success
  ).toBe(true);
});

test("ed25519: a malformed private key fails without retrying", async () => {
  server.use(http.post(url, () => HttpResponse.text("ok")));
  await expect(
    testJitsuFunction<WebhookDestinationConfig>({
      func: WebhookDestination,
      config: {
        url,
        method: "POST",
        signatureMethod: "ed25519",
        signaturePrivateKey: "not-a-real-key",
      } as WebhookDestinationConfig,
      events: [{ type: "track", event: "test_event", messageId: "m1" } as AnalyticsServerEvent],
    })
  ).rejects.toMatchObject({ name: "NoRetryError" });
});

test("ed25519: accepts a bare base64 key body with surrounding whitespace", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const bareBase64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");

  const { signature, timestamp, body } = await sign({
    signatureMethod: "ed25519",
    signaturePrivateKey: `\n  ${bareBase64}  \n`,
  });

  const ok = verify(null, Buffer.from(`${timestamp}.${body}`), publicKey, Buffer.from(signature, "hex"));
  expect(ok).toBe(true);
});
