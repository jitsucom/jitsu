import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { SessionUser, UserWorkspaceRelation } from "../../../../../lib/schema";
import { z } from "zod";
import { assertDefined, requireDefined, randomId } from "juava";
import { db } from "../../../../../lib/server/db";
import { whoamiUrl } from "../../../../../lib/server/whoami";
import { isMailAvailable, sendEmail } from "../../../../../lib/server/mail";
import { ApiError } from "../../../../../lib/shared/errors";
import pick from "lodash/pick";
import { branding } from "../../../../../lib/branding";

async function sendInvitationEmail<Req>(
  email: string,
  currentUser: SessionUser,
  workspaceName: string,
  baseUrl: string,
  token: string
) {
  const link = `${baseUrl}/accept?invite=${token}`;
  await sendEmail({
    to: email,
    subject: `${currentUser.name} has invited you to join ${workspaceName} workspace in ${branding.productName}`,
    html: [
      `<p>${currentUser.name} has invited you to join <b>${workspaceName}</b> workspace in <b>${branding.productName}</b>.</p>`,
      `<p>Accept invitation by clicking on this link <a href="${link}">${link}</a></p>`,
    ].join(``),
  });
}

async function getWorkspace(workspaceIdOrSlug) {
  return await db.prisma().workspace.findFirst({
    where: { OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] },
  });
}

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({ workspaceIdOrSlug: z.string() }),
      result: z.array(UserWorkspaceRelation),
    },
    handle: async ({ req, user, query: { workspaceIdOrSlug } }) => {
      assertDefined(user, "user");
      const workspace = await getWorkspace(workspaceIdOrSlug);
      if (!workspace) {
        throw new ApiError(`Workspace '${workspaceIdOrSlug}' not found`, { status: 404 });
      }
      await verifyAccess(user, workspace.id);
      const currentUsers: UserWorkspaceRelation[] = (
        await db.prisma().workspaceAccess.findMany({ where: { workspaceId: workspace.id }, include: { user: true } })
      ).map(
        res =>
          ({
            workspaceId: workspace.id,
            user: pick(res.user, "id", "name", "loginProvider", "externalId", "externalUsername", "email"),
          } as UserWorkspaceRelation)
      );

      const invitations: UserWorkspaceRelation[] = (
        await db.prisma().invitationToken.findMany({ where: { workspaceId: workspace.id, usedBy: null } })
      ).map(res => ({
        workspaceId: workspace.id,
        invitationLink: `${whoamiUrl(req)}/accept?invite=${res.token}`,
        invitationEmail: res.email,
      }));
      return [...currentUsers, ...invitations] as any;
    },
  },
  POST: {
    auth: true,
    types: {
      body: z.object({ email: z.string(), resend: z.boolean().optional(), cancel: z.boolean().optional() }),
      query: z.object({ workspaceIdOrSlug: z.string() }),
    },
    handle: async ({ user, req, body, query: { workspaceIdOrSlug } }) => {
      const workspace = requireDefined(
        await getWorkspace(workspaceIdOrSlug),
        `Can't find workspace ${workspaceIdOrSlug}`
      );
      await verifyAccess(user, workspace.id);
      const existingInvitation = await db.prisma().invitationToken.findFirst({
        where: { email: body.email, workspaceId: workspace.id, usedBy: null },
      });
      if (body.resend) {
        assertDefined(existingInvitation, `invitation for ${body.email} not found`);
        if (isMailAvailable()) {
          await sendInvitationEmail(body.email, user, workspace.name, whoamiUrl(req), existingInvitation.token);
        }
        return { token: existingInvitation.token };
      } else if (body.cancel) {
        assertDefined(existingInvitation, `invitation for ${body.email} not found`);
        await db.prisma().invitationToken.delete({ where: { id: existingInvitation.id } });
        return { success: true };
      } else {
        if (existingInvitation) {
          throw new Error(`User ${body.email} is already invited`);
        }
        const token = await db.prisma().invitationToken.create({
          data: { email: body.email, workspaceId: workspace.id, token: randomId(12) },
        });
        if (isMailAvailable()) {
          await sendInvitationEmail(body.email, user, workspace.name, whoamiUrl(req), token.token);
        }
        return {
          token: token.token,
          invitationLink: `${whoamiUrl(req)}/accept?invite=${token.token}`,
          canSendEmail: isMailAvailable(),
        };
      }
    },
  },
  DELETE: {
    auth: true,
    types: {
      query: z.object({ email: z.string().optional(), userId: z.string().optional(), workspaceIdOrSlug: z.string() }),
    },
    handle: async ({ user, query: { workspaceIdOrSlug, email, userId } }) => {
      const workspace = requireDefined(
        await getWorkspace(workspaceIdOrSlug),
        `Can't find workspace ${workspaceIdOrSlug}`
      );
      await verifyAccess(user, workspace.id);
      if (email) {
        await db.prisma().invitationToken.deleteMany({ where: { email, workspaceId: workspace.id } });
      } else if (userId) {
        await db.prisma().workspaceAccess.deleteMany({ where: { userId, workspaceId: workspace.id } });
      }
      return { success: true };
    },
  },
};

export default nextJsApiHandler(api);
