import { createRoute, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { requireDefined } from "juava";
import { defaultDataRetentionSettings } from "../../../../../lib/shared/data-retention";
import merge from "lodash/merge";
import { sendEmail } from "../../../../../lib/server/mail";
import { SessionUser } from "../../../../../lib/schema";

async function updateEmailNotification(data: any, workspace, user: SessionUser) {
  if (process.env.ADMIN_EMAIL) {
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `Retention policy update on ${workspace.slug} has been requested`,
      html: [
        `<p><b>${user.name}</b> has requested retention policy update on workspace <b>${workspace.slug}</b> (<code>${workspace.id}</code>)</p>`,
        `<p>Here's a new policy</p>`,
        `<p><pre><code>${JSON.stringify(data, null, 2)}</code></pre></p>`,
      ].join(``),
    });
  }
}

export default createRoute()
  .GET({ auth: true, query: z.object({ section: z.string(), workspaceIdOrSlug: z.string() }) })
  .handler(async ({ query: { section, workspaceIdOrSlug }, user }) => {
    const workspace = requireDefined(
      await db
        .prisma()
        .workspace.findFirst({ where: { OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] } }),
      `Workspace ${workspaceIdOrSlug} not found`
    );
    await verifyAccess(user, workspace.id);
    return (
      (await db.prisma().workspaceOptions.findFirst({ where: { workspaceId: workspace.id, namespace: section } }))
        ?.value || defaultDataRetentionSettings
    );
  })
  .POST({ auth: true, query: z.object({ section: z.string(), workspaceIdOrSlug: z.string() }) })
  .handler(async ({ query: { section, workspaceIdOrSlug }, user, body }) => {
    const workspace = requireDefined(
      await db
        .prisma()
        .workspace.findFirst({ where: { OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] } }),
      `Workspace ${workspaceIdOrSlug} not found`
    );
    await verifyAccess(user, workspace.id);
    if (section == "data-retention") {
      (body as any).pendingUpdate = true;
    }
    const existing = await db.prisma().workspaceOptions.findFirst({
      where: { workspaceId: workspace.id, namespace: section },
    });
    const newValues = merge(existing?.value || defaultDataRetentionSettings, body);
    if (existing) {
      await db.prisma().workspaceOptions.update({
        where: { id: existing.id },
        data: { value: newValues },
      });
    } else {
      await db.prisma().workspaceOptions.create({
        data: { workspaceId: workspace.id, namespace: section, value: newValues },
      });
    }
    if (section === "data-retention") {
      await updateEmailNotification(newValues, workspace, user);
    }
  })

  .toNextApiHandler();
