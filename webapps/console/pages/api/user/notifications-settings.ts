import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { getUserPreferenceService, UserNotificationsPreferences } from "../../../lib/server/user-preferences";
import { z } from "zod";
import { isTruish } from "juava";

export default createRoute()
  .GET({
    auth: true,
    result: UserNotificationsPreferences,
    query: z.object({ workspaceId: z.string().optional(), mergeWithGlobal: z.string().optional() }),
  })
  .handler(async ({ user, query }) => {
    const pref = await getUserPreferenceService(db.prisma()).getPreferences({
      userId: user.internalId,
      workspaceId: query.workspaceId,
    });
    if (query.workspaceId && isTruish(query.mergeWithGlobal)) {
      const globalPref = await getUserPreferenceService(db.prisma()).getPreferences({
        userId: user.internalId,
      });
      return UserNotificationsPreferences.parse({ ...globalPref.notifications, ...pref.notifications });
    }
    return UserNotificationsPreferences.parse(pref.notifications || {});
  })
  .POST({ auth: true, body: UserNotificationsPreferences, query: z.object({ workspaceId: z.string().optional() }) })
  .handler(async ({ user, body, query }) => {
    const pref = await getUserPreferenceService(db.prisma()).getPreferences({
      userId: user.internalId,
      workspaceId: query.workspaceId,
    });
    pref.notifications = UserNotificationsPreferences.parse({ ...pref.notifications, ...body });
    await getUserPreferenceService(db.prisma()).savePreference(
      { userId: user.internalId, workspaceId: query.workspaceId },
      pref
    );
  })
  .toNextApiHandler();
