import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../lib/server/db";
import { ApiError } from "../../../../lib/shared/errors";
import { getUserPreferenceService } from "../../../../lib/server/user-preferences";
import { getLog } from "juava";
const log = getLog();
export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    description: "Get workspace",
    auth: true,
    types: { query: z.object({ workspaceIdOrSlug: z.string() }) },
    handle: async ({ query: { workspaceIdOrSlug }, user }) => {
      const workspace = await db
        .prisma()
        .workspace.findFirst({ where: { OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] } });
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
      //it doesn't have to by sync since the preferences are optional
      getUserPreferenceService(db.prisma())
        .savePreference({ userId: user.internalId }, { lastUsedWorkspaceId: workspace.id })
        .catch(e => {
          log
            .atWarn()
            .withCause(e)
            .log(`Failed to save last workspace id (${workspace.id}). For user (${user.internalId})`);
        });

      return workspace;
    },
  },
  PUT: {
    auth: true,
    types: {
      body: z.object({ name: z.string(), slug: z.string() }),
      query: z.object({ workspaceIdOrSlug: z.string() }),
    },
    handle: async ({ query: { workspaceIdOrSlug }, body, user }) => {
      await verifyAccess(user, workspaceIdOrSlug);
      return await db
        .prisma()
        .workspace.update({ where: { id: workspaceIdOrSlug }, data: { name: body.name, slug: body.slug } });
    },
  },
};

export default nextJsApiHandler(api);
