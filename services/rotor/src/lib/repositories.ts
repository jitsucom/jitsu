import { EnrichedConnectionConfig, FunctionConfig, storeFunc, WorkspaceWithProfiles } from "@jitsu/core-functions";

export const functionsStore = storeFunc<FunctionConfig>("functions");
export const connectionsStore = storeFunc<EnrichedConnectionConfig>("rotor-connections");
export const workspaceStore = storeFunc<WorkspaceWithProfiles>("workspaces-with-profiles");
