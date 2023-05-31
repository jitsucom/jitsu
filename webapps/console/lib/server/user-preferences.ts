import { PrismaClient } from "@prisma/client";
import { merge } from "lodash";

export type PreferencesObj = Record<string, any>;

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
          workspaceId: workspaceId || undefined,
        },
      });
      return merge({}, ...allPreferences.map(p => p.preferences));
    },
    savePreference: async ({ userId, workspaceId }, obj) => {
      const currentPreferences = await prisma.userPreferences.findMany({
        where: {
          userId,
          workspaceId: workspaceId || undefined,
        },
      });
      if (currentPreferences.length === 0) {
        await prisma.userPreferences.create({
          data: {
            userId,
            workspaceId: workspaceId || undefined,
            preferences: obj,
          },
        });
        return obj;
      } else {
        const newValue = merge(currentPreferences[0].preferences, obj);
        await prisma.userPreferences.updateMany({
          where: {
            userId,
            workspaceId: workspaceId || undefined,
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
