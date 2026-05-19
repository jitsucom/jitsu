import { db } from "./db";
import { getServerLog } from "./log";
import { NotificationChannel } from "../schema";
import { sendEmail } from "@jitsu-internal/webapps-shared";
import omit from "lodash/omit";
import { getServerEnv } from "./serverEnv";
import { AccountAlertEmail, AccountAlertEventType } from "../../emails/account-alert";
import { DefaultUserNotificationsPreferences } from "./user-preferences";

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

    // Source 1: explicit email NotificationChannel rows for this workspace
    // that subscribed to "account" / "all". These are the "shared mailing
    // list" use case (e.g. security@company.com). In most installs no such
    // row exists — the in-product notification UI for email channels
    // synthesizes recipients from per-user preferences instead, which is
    // Source 2 below.
    const channelRows = await db.prisma().configurationObject.findMany({
      where: {
        workspaceId: event.workspaceId,
        type: "notification",
        deleted: false,
      },
    });

    const channelSubscribers = channelRows
      .map(row => ({ ...omit(row, "config"), ...((row.config as any) || {}) } as unknown as NotificationChannel))
      .filter(c => c.channel === "email" && Array.isArray(c.emails) && c.emails.length > 0)
      .filter(c => Array.isArray(c.events) && (c.events.includes("account") || c.events.includes("all")));

    // Source 2: workspace members who have left the per-user
    // `notifications.account` toggle on. Mirrors how `pages/api/admin/
    // notifications.ts#loadNotificationsChannels` synthesizes email channels
    // for sync/batch/dead alerts. We can't reuse that helper directly because
    // it lives behind an admin-only cron route.
    // No `w.deleted = false` join here. The workspace existence check at the
    // top of this function already gated dispatch, and for `workspace-deleted`
    // events the workspace IS marked deleted by the time we run — filtering
    // it out would silently drop the alert exactly when it matters most.
    const memberRows = await db.pgPool().query(
      `select wa."userId", u.email, u.name, upw.preferences "workspacePref", upg.preferences "globalPref"
         from newjitsu."WorkspaceAccess" wa
         join newjitsu."UserProfile" u on u.id = wa."userId"
         left outer join newjitsu."UserPreferences" upw on upw."userId" = wa."userId" and upw."workspaceId" = wa."workspaceId"
         left outer join newjitsu."UserPreferences" upg on upg."userId" = wa."userId" and upg."workspaceId" is null
        where wa."workspaceId" = $1`,
      [event.workspaceId]
    );

    const userEmailSet = new Set<string>();
    for (const row of memberRows.rows) {
      const settings = {
        ...DefaultUserNotificationsPreferences,
        ...(row.globalPref?.notifications || {}),
        ...(row.workspacePref?.notifications || {}),
      };
      if (settings.account && row.email) {
        userEmailSet.add(row.email);
      }
    }

    type AlertRecipient = { id: string; emails: string[] };
    const recipients: AlertRecipient[] = [
      ...channelSubscribers.map(c => ({ id: `channel:${c.id}`, emails: c.emails! })),
    ];
    if (userEmailSet.size > 0) {
      recipients.push({ id: "workspace-members", emails: Array.from(userEmailSet) });
    }

    if (recipients.length === 0) {
      return;
    }

    await Promise.all(
      recipients.map(r =>
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
          r.emails,
          {}
        ).catch(err => {
          log.atError().withCause(err).log(`Failed to send account alert to ${r.id} (workspace ${event.workspaceId})`);
        })
      )
    );
  } catch (err) {
    log.atError().withCause(err).log(`dispatchAccountAlert failed for workspace ${event.workspaceId}`);
  }
}
