import { FunctionConfig, storeFunc, Workspace } from "@jitsu/core-functions";

export const functionsStore = storeFunc<FunctionConfig>("functions");
export const workspaceStore = storeFunc<Workspace>("workspaces-with-profiles");
