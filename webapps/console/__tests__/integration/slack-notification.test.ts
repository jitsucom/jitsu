import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./support/msw";
import { sendSlackNotification } from "../../pages/api/admin/notifications";
import type { NotificationChannel } from "../../lib/schema";

// JITSU-258 (R8): the notification test endpoint used to POST to any URL and return the response body.

const entity = {
  type: "batch",
  status: "SUCCESS",
  id: BigInt(1),
  actorId: "test",
  startedAt: new Date(),
  timestamp: new Date(),
  counts: 1,
  workspaceId: "ws",
  tableName: "t",
  description: "__jitsu_" + JSON.stringify({ status: "FIRST_RUN" }),
  queueSize: 1,
  slug: "ws",
  workspaceName: "ws",
  fromName: "Site",
  toName: "Warehouse",
  changesPerHours: 1,
  changesPerDay: 1,
} as any;

const channel = (slackWebhookUrl: string): NotificationChannel =>
  ({
    id: "test",
    channel: "slack",
    type: "notification",
    workspaceId: "ws",
    slackWebhookUrl,
    events: ["all"],
    recurringAlertsPeriodHours: 168,
    name: "Test Slack Channel",
    summarizeBatchNotificationsByTable: true,
  } as any);

afterEach(() => vi.restoreAllMocks());

describe("sendSlackNotification target restrictions", () => {
  it("posts to hooks.slack.com", async () => {
    let posted = false;
    server.use(
      http.post("https://hooks.slack.com/services/T0/B0/X", () => {
        posted = true;
        return HttpResponse.text("ok");
      })
    );
    await sendSlackNotification(
      channel("https://hooks.slack.com/services/T0/B0/X"),
      entity,
      [entity],
      "http://x",
      false
    );
    expect(posted).toBe(true);
  });

  it.each(["http://127.0.0.1:5432/", "http://169.254.169.254/latest/meta-data/", "https://internal.example/hook"])(
    "refuses %s without sending a request",
    async url => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await expect(sendSlackNotification(channel(url), entity, [entity], "http://x", false)).rejects.toThrow(
        /hooks\.slack\.com/
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it("does not return the response body of a failed request", async () => {
    server.use(
      http.post("https://hooks.slack.com/services/T0/B0/FAIL", () =>
        HttpResponse.text("internal-secret-body", { status: 500 })
      )
    );
    const error = await sendSlackNotification(
      channel("https://hooks.slack.com/services/T0/B0/FAIL"),
      entity,
      [entity],
      "http://x",
      false
    ).catch(e => e);
    expect(error.message).toContain("500");
    expect(error.message).not.toContain("internal-secret-body");
  });
});
