import { EnrichedConnectionConfig, FunctionConfig, storeFunc, StreamWithDestinations } from "@jitsu/core-functions";

export const functionsStore = storeFunc<FunctionConfig>("functions");
export const connectionsStore = storeFunc<EnrichedConnectionConfig>("rotor-connections");
export const streamsStore = storeFunc<StreamWithDestinations>("streams-with-destinations");
