import { createRoute } from "../../lib/api";
import { SessionUser } from "../../lib/schema";
import { db } from "../../lib/server/db";
import { requireDefined } from "juava";
import { getServerLog } from "../../lib/server/log";
import { publicEmailDomains } from "../../lib/shared/email-domains";
import { getUserPreferenceService } from "../../lib/server/user-preferences";
import { ApiError } from "../../lib/shared/errors";
import { z } from "zod";
import { initTelemetry, withProductAnalytics } from "../../lib/server/telemetry";

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
  .handler(async ({ req, query, user }) => {
    await initTelemetry();
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
      getServerLog().atInfo().log(`User ${user.internalId} has no access to any workspace. Creating a new one for him`);
      let dbUser = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
      if (!dbUser) {
        //This could happen by two reasons
        //Firebase: internalId is a custom claim, a property of a user. So we're using, another database for main firebase instance
        //in fact, our architecture does not allow to use a firebase with many postgres DBs
        //Self-hosted: seems like the situation is the same as with firebase

        //we'll try to remedy a situation, but it's not going to work for all cases
        getServerLog().atInfo().log(`User ${user.internalId} has no profile in db. Creating a new one`);
        if (process.env.DISABLE_SIGNUP === "true" || process.env.DISABLE_SIGNUP === "1") {
          throw new ApiError("Sign up is disabled", { code: "signup-disabled" });
        }
        if (!user.loginProvider && !user.externalId) {
          //double check so we won't pull first of all users from DB
          throw new ApiError(`Inconsistent state, loginProvider or externalId is empty in users JWT`);
        }
        dbUser = await db
          .prisma()
          .userProfile.findFirst({ where: { loginProvider: user.loginProvider, externalId: user.externalId } });
        if (dbUser) {
          //theoretically we can change custom claim (internalId) in firebase instead of throwing
          throw new ApiError(
            `There's another user with given external id (${user.loginProvider}/${user.externalId}, but different internal id - ${dbUser.id}. Please, delete this user. Passed user id: ${user.internalId}`
          );
        }

        const newUser = await db.prisma().userProfile.create({
          data: {
            id: user.internalId,
            name: user.name,
            email: user.email,
            loginProvider: user.loginProvider,
            externalId: user.externalId,
          },
        });
        await withProductAnalytics(p => p.track("user_created"), { user: { ...newUser, internalId: newUser.id }, req });
      }
      const newWorkspace = await db
        .prisma()
        .workspace.create({ data: { name: pickWorkspaceName(query.projectName, user) } });
      await withProductAnalytics(p => p.track("workspace_created"), { req, user, workspace: newWorkspace });
      await db.prisma().workspaceAccess.create({ data: { userId: user.internalId, workspaceId: newWorkspace.id } });
      getServerLog()
        .atInfo()
        .log(`Created a new workspace ${newWorkspace.id} for user ${user.internalId} (${user.email}).`);
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
