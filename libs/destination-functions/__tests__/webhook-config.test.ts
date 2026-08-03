import { describe, expect, test } from "vitest";
import { WebhookDestinationConfig } from "../src/meta";

describe("WebhookDestinationConfig URL", () => {
  test.each([
    "https://example.com/webhook",
    "http://localhost:3000/hook",
    "http://127.0.0.1:8080/hook",
    "http://[::1]:8080/hook",
    "https://example.com:8443/path?key=value#fragment",
  ])("accepts HTTP(S) URL %s", url => {
    expect(WebhookDestinationConfig.safeParse({ url }).success).toBe(true);
  });

  test.each([
    "ftp://example.com/hook",
    "mailto:user@example.com",
    "data:text/plain,hello",
    "file:///tmp/hook",
    "javascript:alert(1)",
    "https://user@example.com/hook",
    "https://user:pass@example.com/hook",
    "/relative/hook",
    "not a URL",
  ])("rejects unsupported URL %s", url => {
    expect(WebhookDestinationConfig.safeParse({ url }).success).toBe(false);
  });
});
