import { EnrichedConnectionConfig, FunctionConfig, storeFunc, Workspace } from "@jitsu/core-functions";

export const functionsStore = storeFunc<FunctionConfig>("functions");
export const connectionsStore = storeFunc<EnrichedConnectionConfig>("rotor-connections");
export const workspaceStore = storeFunc<Workspace>("workspaces-with-profiles");
