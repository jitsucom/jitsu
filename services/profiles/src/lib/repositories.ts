import { EnrichedConnectionConfig, storeFunc, WorkspaceWithProfiles } from "@jitsu/core-functions";

export const profilesStore = storeFunc<WorkspaceWithProfiles>("workspaces-with-profiles");
export const connectionsStore = storeFunc<EnrichedConnectionConfig>("rotor-connections");
