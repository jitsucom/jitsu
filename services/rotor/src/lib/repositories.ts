import {
  EnrichedConnectionConfig,
  FunctionConfig,
  storeFunc,
  StreamWithDestinations,
  WorkspaceWithProfiles,
} from "@jitsu/destination-functions";

export const functionsStore = storeFunc<FunctionConfig>("functions");
export const workspacesStore = storeFunc<WorkspaceWithProfiles>("workspaces-with-profiles");
export const connectionsStore = storeFunc<EnrichedConnectionConfig>("rotor-connections");
export const streamsStore = storeFunc<StreamWithDestinations>("streams-with-destinations");
