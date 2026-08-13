import { createRoute, verifyAccess, verifyAccessWithRole } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { requireDefined } from "juava";
import {
  defaultObservabilityExportsSettings,
  maskObservabilityExportsSettings,
  observabilityExportsNamespace,
  ObservabilityExportsSettings,
  unmaskObservabilityExportsSettings,
} from "../../../../../lib/shared/observability-exports";
import { workspaceAuditLog } from "../../../../../lib/server/audit-log";

async function getWorkspace(workspaceIdOrSlug: string) {
  return requireDefined(
    await db.prisma().workspace.findFirst({ where: { OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] } }),
    `Workspace ${workspaceIdOrSlug} not found`
  );
}

async function getStoredSettings(workspaceId: string) {
  const row = await db.prisma().workspaceOptions.findFirst({
    where: { workspaceId, namespace: observabilityExportsNamespace },
  });
  const parsed = row ? ObservabilityExportsSettings.safeParse(row.value) : undefined;
  return { row, settings: parsed?.success ? parsed.data : defaultObservabilityExportsSettings };
}

export default createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceIdOrSlug: z.string() }),
    result: ObservabilityExportsSettings,
  })
  .handler(async ({ query: { workspaceIdOrSlug }, user }) => {
    const workspace = await getWorkspace(workspaceIdOrSlug);
    await verifyAccess(user, workspace.id);
    const { settings } = await getStoredSettings(workspace.id);
    return maskObservabilityExportsSettings(settings);
  })
  .PUT({
    auth: true,
    query: z.object({ workspaceIdOrSlug: z.string() }),
    body: ObservabilityExportsSettings,
    result: ObservabilityExportsSettings,
  })
  .handler(async ({ query: { workspaceIdOrSlug }, user, body, req }) => {
    const workspace = await getWorkspace(workspaceIdOrSlug);
    await verifyAccessWithRole(user, workspace.id, "editEntities");
    const { row, settings: stored } = await getStoredSettings(workspace.id);
    const newSettings = unmaskObservabilityExportsSettings(ObservabilityExportsSettings.parse(body), stored);
    if (row) {
      await db.prisma().workspaceOptions.update({ where: { id: row.id }, data: { value: newSettings } });
    } else {
      await db.prisma().workspaceOptions.create({
        data: { workspaceId: workspace.id, namespace: observabilityExportsNamespace, value: newSettings },
      });
    }
    // audit with header values masked — workspaceAuditLog stores `changes` as passed
    await workspaceAuditLog(
      user,
      workspace.id,
      "updated",
      {
        prevVersion: { observabilityExports: maskObservabilityExportsSettings(stored) },
        newVersion: { observabilityExports: maskObservabilityExportsSettings(newSettings) },
        workspaceName: workspace.name,
      },
      req
    );
    return maskObservabilityExportsSettings(newSettings);
  })
  .toNextApiHandler();
