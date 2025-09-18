import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";

const InvitationInfo = z.object({
  id: z.string(),
  token: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  email: z.string(),
  role: z.string(),
  createdAt: z.date(),
  invitedBy: z.string().optional(),
});

export default createRoute()
  .GET({
    auth: true,
    result: z.array(InvitationInfo),
  })
  .handler(async ({ user }) => {
    // Get all pending invitations for the current user's email
    const invitations = await db.prisma().invitationToken.findMany({
      where: {
        email: user.email,
        usedBy: null, // Only get unused invitations
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Get workspace information for each invitation
    const invitationsWithWorkspace = await Promise.all(
      invitations.map(async invitation => {
        const workspace = await db.prisma().workspace.findFirst({
          where: { id: invitation.workspaceId, deleted: false },
          select: { name: true },
        });
        if (!workspace) {
          return null;
        }

        return {
          id: invitation.id,
          token: invitation.token,
          workspaceId: invitation.workspaceId,
          workspaceName: workspace?.name || "Unknown Workspace",
          email: invitation.email,
          role: invitation.role,
          createdAt: invitation.createdAt,
        };
      })
    );

    return invitationsWithWorkspace.filter(invitation => invitation !== null);
  })
  .toNextApiHandler();
