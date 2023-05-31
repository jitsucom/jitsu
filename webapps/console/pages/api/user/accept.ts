import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { requireDefined } from "juava";
import { db } from "../../../lib/server/db";

export default createRoute()
  .POST({
    auth: true,
    body: z.object({ invitationToken: z.string() }),
    result: z.object({
      accepted: z.boolean(),
      details: z.string().optional(),
      workspaceName: z.string().optional(),
      workspaceId: z.string().optional(),
    }),
  })
  .handler(async ({ user, body }) => {
    const token = await db.prisma().invitationToken.findFirst({ where: { token: body.invitationToken } });
    if (!token) {
      return { accepted: false, details: `Token ${body.invitationToken} was not found` };
    } else if (token.usedBy && token.usedBy === user.internalId) {
      const access = await db
        .prisma()
        .workspaceAccess.findFirst({ where: { userId: user.internalId, workspaceId: token.workspaceId } });
      if (!access) {
        return {
          accepted: false,
          details: `Token ${body.invitationToken} was used by you, but you don't have an access to this workspace anymore`,
        };
      } else {
        const workspace = requireDefined(
          await db.prisma().workspace.findFirst({ where: { id: token.workspaceId } }),
          `workspace with id ${token.workspaceId} not found`
        );
        return { accepted: true, workspaceName: workspace.name, workspaceId: workspace.id };
      }
    } else if (token.usedBy) {
      return { accepted: false, details: `Token ${body.invitationToken} has been already used` };
    }

    const currentAccess = await db.prisma().workspaceAccess.findFirst({
      where: { userId: user.internalId, workspaceId: token.workspaceId },
      include: { workspace: true },
    });
    if (currentAccess) {
      return { accepted: false, details: `You already have an access to ${currentAccess.workspace.name} workspace` };
    }

    const workspace = requireDefined(
      await db.prisma().workspace.findFirst({ where: { id: token.workspaceId } }),
      `workspace with id ${token.workspaceId} not found`
    );
    await db.prisma().workspaceAccess.create({ data: { userId: user.internalId, workspaceId: token.workspaceId } });
    await db.prisma().invitationToken.update({ where: { id: token.id }, data: { usedBy: user.internalId } });
    return { accepted: true, workspaceName: workspace.name, workspaceId: workspace.id };
  })
  .toNextApiHandler();
