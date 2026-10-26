import { describe, expect, it } from "vitest";
import { isSlackWebhookUrl } from "../../lib/shared/slack-webhook";

describe("isSlackWebhookUrl", () => {
  it("accepts Slack incoming webhook urls", () => {
    expect(isSlackWebhookUrl("https://hooks.slack.com/services/T000/B000/XXXX")).toBe(true);
  });

  it.each([
    "http://hooks.slack.com/services/T000/B000/XXXX",
    "https://hooks.slack.com:8443/services/T000/B000/XXXX",
    "https://hooks.slack.com@evil.example/services/x",
    "https://user:pass@hooks.slack.com/services/x",
    "https://hooks.slack.com.evil.example/services/x",
    "https://evil.example/hooks.slack.com/services/x",
    "https://evil.example/#https://hooks.slack.com/services/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:5432/",
    "file:///etc/passwd",
    "hooks.slack.com/services/x",
    "",
  ])("rejects %s", value => {
    expect(isSlackWebhookUrl(value)).toBe(false);
  });
});
