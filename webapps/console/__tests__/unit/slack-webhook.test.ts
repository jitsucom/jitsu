import { describe, expect, it } from "vitest";
import { isSlackWebhookUrl } from "../../lib/shared/slack-webhook";
import { getConfigObjectType } from "../../lib/schema/config-objects";

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

// The save-time half of the restriction: a channel with another host never gets stored (the send-time check is tested
// in __tests__/integration/slack-notification.test.ts).
describe("notification channel inputFilter", () => {
  const inputFilter = getConfigObjectType("notification").inputFilter;
  const slackChannel = (slackWebhookUrl: string) => ({
    id: "c1",
    type: "notification",
    workspaceId: "ws",
    name: "Slack",
    channel: "slack",
    slackWebhookUrl,
    events: ["all"],
    recurringAlertsPeriodHours: 168,
    summarizeBatchNotificationsByTable: true,
  });
  const run = (obj: any, op: "create" | "update" = "create") => inputFilter(obj, op, { id: "ws" } as any);

  it("stores a channel that posts to hooks.slack.com", async () => {
    const channel = slackChannel("https://hooks.slack.com/services/T000/B000/XXXX");
    await expect(run(channel)).resolves.toMatchObject({ id: "c1" });
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "https://internal.example/hook",
    "https://hooks.slack.com@evil.example/x",
  ])("refuses %s with a 400, on create and on update", async url => {
    for (const op of ["create", "update"] as const) {
      await expect(run(slackChannel(url), op)).rejects.toMatchObject({ status: 400 });
    }
  });

  it("does not apply the Slack restriction to an e-mail channel", async () => {
    const email = { ...slackChannel(""), channel: "email", slackWebhookUrl: undefined, emails: ["a@example.com"] };
    await expect(run(email)).resolves.toMatchObject({ channel: "email" });
  });
});
