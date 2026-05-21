import { createRoute } from "../../lib/api";
import { db } from "../../lib/server/db";
import { requireDefined } from "juava";
import { getServerLog } from "../../lib/server/log";
import { getUserPreferenceService } from "../../lib/server/user-preferences";
import { ApiError } from "../../lib/shared/errors";
import { initTelemetry, withProductAnalytics } from "../../lib/server/telemetry";
import { onUserCreated } from "../../lib/server/ee";
import { getServerEnv } from "../../lib/server/serverEnv";

const serverEnv = getServerEnv();

export default createRoute()
  .GET({
    auth: true,
  })
  .handler(async ({ req, query, user }) => {
    await initTelemetry();
    const workspaceAccess = await db.prisma().workspaceAccess.findFirst({
      where: { userId: requireDefined(user.internalId, `internal id is not defined`) },
    });
    if (!workspaceAccess) {
      getServerLog().atInfo().log(`User ${user.internalId} has no access to any workspace. Checking for invitations`);
      let dbUser = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
      if (!dbUser) {
        //This could happen by two reasons
        //Firebase: internalId is a custom claim, a property of a user. So we're using, another database for main firebase instance
        //in fact, our architecture does not allow to use a firebase with many postgres DBs
        //Self-hosted: seems like the situation is the same as with firebase

        //we'll try to remedy a situation, but it's not going to work for all cases
        getServerLog().atInfo().log(`User ${user.internalId} has no profile in db. Creating a new one`);
        if (serverEnv.DISABLE_SIGNUP) {
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
        await onUserCreated(req, { email: user.email, name: user.name });
      }

      // Check if user has pending invitations
      const pendingInvitations = await db.prisma().invitationToken.findMany({
        where: {
          email: user.email,
          usedBy: null, // Only unused invitations
        },
      });

      if (pendingInvitations.length > 0) {
        getServerLog()
          .atInfo()
          .log(
            `User ${user.internalId} has ${pendingInvitations.length} pending invitations. Redirecting to workspaces page`
          );
        return { user: user, redirect: "/workspaces" };
      }

      // Return a redirect to new workspace creation page
      return { user: user, redirect: "/new-workspace" };
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
