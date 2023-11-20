import { createRoute } from "../../lib/api";
import { SessionUser } from "../../lib/schema";
import { db } from "../../lib/server/db";
import { requireDefined } from "juava";
import { getServerLog } from "../../lib/server/log";
import { publicEmailDomains } from "../../lib/shared/email-domains";
import { getUserPreferenceService } from "../../lib/server/user-preferences";
import { ApiError } from "../../lib/shared/errors";
import { z } from "zod";
import { initTelemetry } from "../../lib/server/telemetry";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pickWorkspaceName(projectName: string | undefined, user: SessionUser) {
  if (projectName) {
    return projectName;
  }
  if (!user.email) {
    return `${user.name}'s workspace`;
  }
  const [username, domain] = user.email.split("@");
  if (publicEmailDomains.includes(domain.toLowerCase())) {
    return `${username}'s workspace`;
  } else {
    const [company, ...rest] = domain.split(".");
    return `${capitalize(company)}'s workspace`;
  }
}

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      projectName: z.string().optional(),
      invite: z.string().optional(),
    }),
  })
  .handler(async ({ query, user }) => {
    initTelemetry();
    getServerLog()
      .atInfo()
      .log(`Looking for workspace for user ${JSON.stringify(user)}`);
    if (query.invite) {
      const token = await db.prisma().invitationToken.findFirst({ where: { token: query.invite } });
      if (!token) {
        getServerLog().atWarn().log(`Token ${query.invite} for user ${user.internalId} (${user.email}) was not found`);
      } else if (token.usedBy) {
        getServerLog()
          .atWarn()
          .log(`Token ${query.invite} is used ${token.usedBy}. Current user: ${user.internalId} (${user.email})`);
      } else {
        const currentAccess = await db.prisma().workspaceAccess.findFirst({
          where: { userId: user.internalId, workspaceId: token.workspaceId },
          include: { workspace: true },
        });
        if (currentAccess) {
          getServerLog()
            .atWarn()
            .log(
              `User ${user.internalId} (${user.email}) already has an access to ${currentAccess.workspace.name} workspace. Token: ${query.invite}`
            );
          return { user: user, firstWorkspaceId: currentAccess.workspaceId, firstWorkspaceSlug: null };
        } else {
          const workspace = requireDefined(
            await db.prisma().workspace.findFirst({ where: { id: token.workspaceId } }),
            `Invalid invitation token. Workspace with id ${token.workspaceId} not found`
          );
          await db
            .prisma()
            .workspaceAccess.create({ data: { userId: user.internalId, workspaceId: token.workspaceId } });
          await db.prisma().invitationToken.update({ where: { id: token.id }, data: { usedBy: user.internalId } });
          return { user: user, firstWorkspaceId: token.workspaceId, firstWorkspaceSlug: null };
        }
      }
    }
    const workspaceAccess = await db.prisma().workspaceAccess.findFirst({
      where: { userId: requireDefined(user.internalId, `internal id is not defined`) },
    });
    if (!workspaceAccess) {
      const dbUser = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
      if (!dbUser) {
        if (process.env.DISABLE_SIGNUP === "true" || process.env.DISABLE_SIGNUP === "1") {
          throw new ApiError("Sign up is disabled", { code: "signup-disabled" });
        }
        //incorrect state, current session has internalId but no user in db. Fix it by creating a new user
        const newUser = await db.prisma().userProfile.create({
          data: {
            name: user.name,
            email: user.email,
            loginProvider: user.loginProvider,
            externalId: user.externalId,
          },
        });
        await db.prisma().$queryRaw`UPDATE "UserProfile"
                                  SET "id" = ${user.internalId}
                                  WHERE "id" = ${newUser.id}`;
      }
      const newWorkspace = await db
        .prisma()
        .workspace.create({ data: { name: pickWorkspaceName(query.projectName, user) } });
      await db.prisma().workspaceAccess.create({ data: { userId: user.internalId, workspaceId: newWorkspace.id } });
      return { user: user, firstWorkspaceId: newWorkspace.id, firstWorkspaceSlug: null, newUser: true };
    }
    const lastUsedWorkspaceId = (
      await getUserPreferenceService(db.prisma()).getPreferences({ userId: user.internalId })
    )?.lastUsedWorkspaceId;
    if (lastUsedWorkspaceId) {
      const lastUsedWorkspaceSlug = (
        await db
          .prisma()
          .workspace.findFirst({ where: { id: lastUsedWorkspaceId, deleted: false }, select: { slug: true } })
      )?.slug;
      if (lastUsedWorkspaceSlug) {
        return {
          user: user,
          firstWorkspaceId: lastUsedWorkspaceId,
          firstWorkspaceSlug: lastUsedWorkspaceSlug,
        };
      }
    }
    return {
      user: user,
      firstWorkspaceId: workspaceAccess.workspaceId,
      firstWorkspaceSlug: workspaceAccess["workspace"]?.slug,
    };
  })
  .toNextApiHandler();
