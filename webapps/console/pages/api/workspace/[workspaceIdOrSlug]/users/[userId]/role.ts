import { Api, inferUrl, nextJsApiHandler, verifyAccessWithRole } from "../../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../../lib/server/db";
import { ApiError } from "../../../../../../lib/shared/errors";
import { requireDefined } from "juava";
import { WorkspaceRolesZodType } from "../../../../../../lib/workspace-roles";

async function getWorkspace(workspaceIdOrSlug: string) {
  return await db.prisma().workspace.findFirst({
    where: { OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] },
  });
}

const api: Api = {
  url: inferUrl(__filename),
  PUT: {
    auth: true,
    types: {
      query: z.object({ workspaceIdOrSlug: z.string(), userId: z.string() }),
      body: z.object({ role: WorkspaceRolesZodType }),
    },
    handle: async ({ user, body, query: { workspaceIdOrSlug, userId } }) => {
      const workspace = requireDefined(
        await getWorkspace(workspaceIdOrSlug),
        `Can't find workspace ${workspaceIdOrSlug}`
      );

      // Only owners can change roles
      await verifyAccessWithRole(user, workspace.id, "manageUsers");

      // Check if the target user has access to the workspace
      const access = await db.prisma().workspaceAccess.findFirst({
        where: { userId, workspaceId: workspace.id },
      });

      if (!access) {
        throw new ApiError(`User ${userId} doesn't have access to workspace ${workspace.id}`, { status: 404 });
      }

      // Prevent removing the last owner
      if (access.role == "owner" && body.role !== "owner") {
        const ownerCount = await db.prisma().workspaceAccess.count({
          where: { workspaceId: workspace.id, role: "owner" },
        });

        if (ownerCount <= 1) {
          throw new ApiError("Cannot remove the last owner of the workspace", { status: 400 });
        }
      }

      // Update the role
      await db.prisma().workspaceAccess.update({
        where: { userId_workspaceId: { userId, workspaceId: workspace.id } },
        data: { role: body.role },
      });

      return { success: true, role: body.role };
    },
  },
};

export default nextJsApiHandler(api);
