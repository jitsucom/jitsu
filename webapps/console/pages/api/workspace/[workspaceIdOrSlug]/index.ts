import { createRoute, verifyAccess, verifyAccessWithRole } from "../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../lib/server/db";
import { ApiError } from "../../../../lib/shared/errors";
import {
  DefaultUserNotificationsPreferences,
  getUserPreferenceService,
  PreferencesObj,
} from "../../../../lib/server/user-preferences";
import { getServerLog } from "../../../../lib/server/log";
import { SessionUser } from "../../../../lib/schema";
import { initTelemetry, withProductAnalytics } from "../../../../lib/server/telemetry";
import { isEqual } from "juava";
import { randomUUID } from "crypto";
import { validateSlug, validateWorkspaceName } from "../validate";
import { workspaceAuditLog } from "../../../../lib/server/audit-log";

const log = getServerLog();

async function savePreferences(user: SessionUser, workspace): Promise<void> {
  await Promise.all([
    ensureUserPreferences(user, workspace),
    db.prisma().workspaceUserProperties.upsert({
      where: {
        workspaceId_userId: { userId: user.internalId, workspaceId: workspace.id },
      },
      create: {
        userId: user.internalId,
        workspaceId: workspace.id,
        lastUsed: new Date(),
      },
      update: {
        lastUsed: new Date(),
      },
    }),
  ]);
}

async function ensureUserPreferences(user: SessionUser, workspace): Promise<void> {
  const [globalPreferences, workspacePreferences] = await Promise.all([
    getUserPreferenceService(db.prisma()).getPreferences({ userId: user.internalId }),
    getUserPreferenceService(db.prisma()).getPreferences({ userId: user.internalId, workspaceId: workspace.id }),
  ]);
  const newGlobalPreferences = {
    ...globalPreferences,
    lastUsedWorkspaceId: workspace.id,
  };
  if (!newGlobalPreferences.notifications) {
    newGlobalPreferences.notifications = {
      ...DefaultUserNotificationsPreferences,
      subscriptionCode: randomUUID(),
    };
  }
  const savePromises: Promise<PreferencesObj>[] = [];
  if (!isEqual(globalPreferences, newGlobalPreferences)) {
    savePromises.push(
      getUserPreferenceService(db.prisma()).savePreference({ userId: user.internalId }, newGlobalPreferences)
    );
  }
  if (!workspacePreferences.notifications) {
    const newWorkspacePreferences = {
      ...workspacePreferences,
      notifications: {
        ...newGlobalPreferences.notifications,
        subscriptionCode: randomUUID(),
      },
    };
    savePromises.push(
      getUserPreferenceService(db.prisma()).savePreference(
        { userId: user.internalId, workspaceId: workspace.id },
        newWorkspacePreferences
      )
    );
  }
  if (savePromises.length > 0) {
    log.atInfo().log(`Saving user preferences for user ${user.internalId} and workspace ${workspace.id}`);
    await Promise.all(savePromises);
  }
}

export const route = createRoute()
  .GET({
    auth: true,
    description: "Get workspace",
    summary: "Get workspace",
    tags: ["workspace"],
    query: z.object({ workspaceIdOrSlug: z.string() }),
  })
  .handler(async ({ req, query: { workspaceIdOrSlug }, user }) => {
    await initTelemetry();
    const workspace = await db.prisma().workspace.findFirst({
      where: { OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] },
      include: {
        oidcLoginGroups: {
          where: {
            oidcProvider: {
              enabled: true,
            },
          },
          include: {
            oidcProvider: {
              select: {
                id: true,
                name: true,
                enabled: true,
              },
            },
          },
        },
      },
    });
    if (!workspace) {
      throw new ApiError(`Workspace '${workspaceIdOrSlug}' not found`, { status: 404 });
    }
    try {
      await verifyAccess(user, workspace.id);
    } catch (e) {
      throw new ApiError(
        `Current user doesn't have an access to workspace`,
        {
          noAccessToWorkspace: true,
        },
        { status: 403 }
      );
    }
    if (workspace.slug) {
      withProductAnalytics(
        callback =>
          callback.track("workspace_access", {
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            workspaceSlug: workspace.slug,
          }),
        { user, workspace, req }
      );
    }

    try {
      await savePreferences(user, workspace);
    } catch (e) {
      log
        .atWarn()
        .withCause(e)
        .log(`Failed to save workspace preferences (${workspace.id}). For user (${user.internalId})`);
    }

    // NOTE: deliberately keeps `deleted: true/false` on this response. The
    // WorkspacePageLayout redirect guard (components/PageLayout/WorkspacePageLayout.tsx)
    // reads `workspace.deleted` to bounce users out of soft-deleted workspaces —
    // stripping the field would silently skip the redirect.
    return workspace;
  })
  .PUT({
    auth: true,
    summary: "Update workspace",
    tags: ["workspace"],
    body: z.object({ name: z.string(), slug: z.string() }),
    query: z.object({
      workspaceIdOrSlug: z.string(),
    }),
  })
  .handler(async ({ req, query: { workspaceIdOrSlug }, body, user }) => {
    // `onboarding` is an internal telemetry signal set by the console's signup flow.
    // Read it from req.query directly so it stays out of the public OpenAPI spec.
    const onboarding = req.query?.onboarding;
    await verifyAccessWithRole(user, workspaceIdOrSlug, "editEntities");

    const nameResult = validateWorkspaceName(body.name || "");
    if (!nameResult.valid) {
      throw new ApiError(`Invalid workspace name: ${nameResult.reason}`, { status: 400 });
    }
    const slugResult = await validateSlug(body.slug || "", workspaceIdOrSlug);
    if (!slugResult.valid) {
      throw new ApiError(`Invalid workspace slug: ${slugResult.reason}`, { status: 400 });
    }

    const prev = await db.prisma().workspace.findUnique({ where: { id: workspaceIdOrSlug } });
    const workspace = await db.prisma().workspace.update({
      where: { id: workspaceIdOrSlug },
      data: { name: body.name.trim(), slug: body.slug.trim() },
    });
    // Skip the audit row when nothing observable changed (no-op save) so owners
    // aren't spammed with empty workspace-updated entries. (PR #1288)
    if (prev && (prev.name !== workspace.name || prev.slug !== workspace.slug)) {
      await workspaceAuditLog(user, workspace.id, "updated", {
        prevVersion: { name: prev.name, slug: prev.slug },
        newVersion: { name: workspace.name, slug: workspace.slug },
        workspaceName: workspace.name,
      });
    }
    if (onboarding === "true") {
      await withProductAnalytics(callback => callback.track("workspace_onboarded"), { user, workspace, req });
    }
    return workspace;
  });

export default route.toNextApiHandler();
