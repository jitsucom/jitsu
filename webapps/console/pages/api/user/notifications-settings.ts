import { assertNotLimitedKey, createRoute } from "../../../lib/api";
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
    // the user's own notification settings, global or of any workspace: account-level, not for a limited key
    assertNotLimitedKey(user);
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
    assertNotLimitedKey(user);
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
