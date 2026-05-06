import { db } from "./db";
import { getServerLog } from "./log";
import { NotificationChannel } from "../schema";
import { sendEmail } from "@jitsu-internal/webapps-shared";
import omit from "lodash/omit";
import { getServerEnv } from "./serverEnv";
import { AccountAlertEmail, AccountAlertEventType } from "../../emails/account-alert";

const log = getServerLog("account-alerts");

export type AccountAlertEvent = {
  eventType: AccountAlertEventType;
  workspaceId: string;
  occurredAt: Date;
  actorEmail?: string;
  actorName?: string;
  targetEmail?: string;
  prevRole?: string;
  newRole?: string;
};

function getBaseUrl(): string | undefined {
  const env = getServerEnv();
  let url = env.JITSU_PUBLIC_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined);
  if (!url) {
    return undefined;
  }
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function dispatchAccountAlert(event: AccountAlertEvent): Promise<void> {
  try {
    const workspace = await db.prisma().workspace.findUnique({
      where: { id: event.workspaceId },
    });
    if (!workspace || workspace.deleted) {
      // For workspace-deleted we still want to dispatch — re-fetch including deleted.
      if (event.eventType !== "workspace-deleted") {
        return;
      }
    }
    const ws =
      workspace ||
      (await db.prisma().workspace.findUnique({
        where: { id: event.workspaceId },
      }));
    const workspaceName = ws?.name || "Your Jitsu Workspace";
    const slug = ws?.slug || ws?.id || event.workspaceId;
    const baseUrl = getBaseUrl();
    const workspaceUrl = baseUrl ? `${baseUrl}/${slug}` : slug;
    const auditLogUrl = baseUrl ? `${baseUrl}/${slug}/settings/audit-log` : `${slug}/settings/audit-log`;

    const channelRows = await db.prisma().configurationObject.findMany({
      where: {
        workspaceId: event.workspaceId,
        type: "notification",
        deleted: false,
      },
    });

    const subscribers = channelRows
      .map(row => ({ ...omit(row, "config"), ...((row.config as any) || {}) } as unknown as NotificationChannel))
      .filter(c => c.channel === "email" && Array.isArray(c.emails) && c.emails.length > 0)
      .filter(c => Array.isArray(c.events) && (c.events.includes("account") || c.events.includes("all")));

    if (subscribers.length === 0) {
      return;
    }

    await Promise.all(
      subscribers.map(channel =>
        sendEmail(
          AccountAlertEmail,
          {
            workspaceName,
            workspaceUrl,
            auditLogUrl,
            eventType: event.eventType,
            occurredAt: event.occurredAt.toISOString(),
            actorEmail: event.actorEmail,
            actorName: event.actorName,
            targetEmail: event.targetEmail,
            prevRole: event.prevRole,
            newRole: event.newRole,
          },
          channel.emails!,
          {}
        ).catch(err => {
          log
            .atError()
            .withCause(err)
            .log(`Failed to send account alert to channel ${channel.id} (workspace ${event.workspaceId})`);
        })
      )
    );
  } catch (err) {
    log
      .atError()
      .withCause(err)
      .log(`dispatchAccountAlert failed for workspace ${event.workspaceId}`);
  }
}
