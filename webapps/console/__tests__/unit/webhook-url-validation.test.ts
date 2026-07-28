import { describe, expect, test } from "vitest";
import { coreDestinationsMap } from "../../lib/schema/destinations";
import { INVALID_WEBHOOK_URL_MESSAGE, validateWebhookUrl } from "../../lib/schema/webhook-url-validation";

describe("Webhook destination URL field", () => {
  test.each([
    "https://example.com/webhook",
    "http://localhost:3000/hook",
    "http://127.0.0.1:8080/hook",
    "http://[::1]:8080/hook",
    "https://example.com:8443/path?key=value#fragment",
  ])("accepts HTTP(S) URL %s", value => {
    expect(validateWebhookUrl(value)).toBeUndefined();
  });

  test.each([
    undefined,
    "",
    "ftp://example.com/hook",
    "mailto:user@example.com",
    "data:text/plain,hello",
    "file:///tmp/hook",
    "javascript:alert(1)",
    "https://user@example.com/hook",
    "https://user:pass@example.com/hook",
    "/relative/hook",
    "not a URL",
  ])("rejects unsupported URL %s", value => {
    expect(validateWebhookUrl(value)).toBe(INVALID_WEBHOOK_URL_MESSAGE);
  });

  test("uses a friendly example-based error message", () => {
    expect(INVALID_WEBHOOK_URL_MESSAGE).toBe(
      "must be a valid HTTP(S) URL without embedded credentials, for example https://example.com/webhook"
    );
  });

  test("registers the validator on the Webhook URL field", () => {
    expect(coreDestinationsMap.webhook.credentialsUi?.url?.clientValidator).toBe(validateWebhookUrl);
  });
});
