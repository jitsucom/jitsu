import { createRoute, verifyAccess } from "../../../lib/api";
import { getServerLog } from "../../../lib/server/log";
import { z } from "zod";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { _J_PREF, sendSlackNotification, StatusChange, StatusChangeEntity } from "../admin/notifications";
import { NotificationChannel } from "../../../lib/schema";
import { requireDefined } from "juava";
import { db } from "../../../lib/server/db";
import { getAppEndpoint } from "../../../lib/domains";

dayjs.extend(utc);

const log = getServerLog("notifications");

export default createRoute()
  .POST({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
    }),
    body: z.object({
      slackWebhookUrl: z.string(),
      recurringAlertsPeriodHours: z.number(),
    }),
    result: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  })
  .handler(async ({ req, body, user, query: { workspaceId } }) => {
    await verifyAccess(user, workspaceId);
    const publicEndpoints = getAppEndpoint(req);
    const { slackWebhookUrl, recurringAlertsPeriodHours } = body;

    try {
      const workspace = requireDefined(
        await db.prisma().workspace.findFirst({ where: { id: workspaceId } }),
        `Workspace ${workspaceId} not found`
      );
      const con = await db.prisma().configurationObjectLink.findFirst({
        where: {
          workspaceId,
          deleted: false,
          workspace: { deleted: false },
          from: { deleted: false },
          to: { deleted: false },
        },
        include: { from: true, to: true, workspace: true },
      });
      // test slack webhook endpoint
      const channel: NotificationChannel = {
        id: "test",
        channel: "slack",
        type: "notification",
        workspaceId: workspaceId,
        slackWebhookUrl,
        events: ["all"],
        recurringAlertsPeriodHours: recurringAlertsPeriodHours || 24,
        name: "Test Slack Channel",
      };
      const statusChange: StatusChange = {
        status: "SUCCESS",
        id: BigInt(1),
        actorId: con?.id || "test",
        startedAt: new Date(),
        timestamp: new Date(),
        counts: 1,
        workspaceId: workspaceId,
        tableName: con?.type === "sync" ? "" : "notification-test",
        description: _J_PREF + JSON.stringify({ status: "FIRST_RUN" }),
        queueSize: 123,
      };
      const entity: StatusChangeEntity = {
        ...statusChange,
        id: BigInt(1),
        type: con?.type === "sync" ? "sync" : "batch",
        slug: workspace.slug || workspaceId,
        workspaceName: workspace.name,
        fromName: (con?.from?.config as any)["name"] ?? "Site",
        toName: (con?.to?.config as any)["name"] ?? "Warehouse",
        changesPerHours: 1,
        changesPerDay: 1,
      };
      await sendSlackNotification(channel, entity, [statusChange], publicEndpoints.baseUrl);
      return { ok: true };
    } catch (e: any) {
      log.atError().withCause(e).log("Error sending test notification");
      return { ok: false, error: e.message };
    }
  })
  .toNextApiHandler();
