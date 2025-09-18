import { PrismaClient } from "@prisma/client";
import merge from "lodash/merge";
import { z } from "zod";

export const UserNotificationsPreferences = z.object({
  batches: z.boolean().default(true),
  syncs: z.boolean().default(true),
  recurringAlertsPeriodHours: z.coerce.number().max(720).min(0).default(24),
  subscriptionCode: z.string().optional(),
});

export type UserNotificationsPreferences = z.infer<typeof UserNotificationsPreferences>;

export const DefaultUserNotificationsPreferences: UserNotificationsPreferences = {
  batches: true,
  syncs: true,
  recurringAlertsPeriodHours: 24,
};

export type PreferencesObj = {
  lastUsedWorkspaceId?: string;
  notifications?: UserNotificationsPreferences;
  [key: string]: any;
};

export type PreferenceOpts = {
  userId: string;
  workspaceId?: string;
};
export type UserPreferencesService = {
  getPreferences: (opts: PreferenceOpts) => Promise<PreferencesObj>;
  savePreference: (opts: PreferenceOpts, obj: Partial<PreferencesObj>) => Promise<PreferencesObj>;
};

export function getUserPreferenceService(prisma: PrismaClient): UserPreferencesService {
  return {
    getPreferences: async ({ userId, workspaceId }) => {
      const allPreferences = await prisma.userPreferences.findMany({
        where: {
          userId,
          workspaceId: workspaceId ?? null,
        },
      });
      return merge({}, ...allPreferences.map(p => p.preferences));
    },
    savePreference: async ({ userId, workspaceId }, obj) => {
      const currentPreferences = await prisma.userPreferences.findMany({
        where: {
          userId,
          workspaceId: workspaceId ?? null,
        },
      });
      if (currentPreferences.length === 0) {
        await prisma.userPreferences.create({
          data: {
            userId,
            workspaceId: workspaceId ?? null,
            preferences: obj,
          },
        });
        return obj;
      } else {
        const newValue = merge(currentPreferences[0].preferences, obj);
        await prisma.userPreferences.updateMany({
          where: {
            userId,
            workspaceId: workspaceId ?? null,
          },
          data: {
            preferences: newValue,
          },
        });
        return newValue;
      }
    },
  };
}
