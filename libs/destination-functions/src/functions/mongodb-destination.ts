import { JitsuFunction } from "@jitsu/protocols/functions";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { MongodbDestinationConfig } from "../meta";

const MongodbDestination: JitsuFunction<AnalyticsServerEvent, MongodbDestinationConfig> = async (event, ctx) => {
  // This is a placeholder function.
  // The actual implementation is in services/rotor/src/lib/mongodb-destination.ts
};

MongodbDestination.displayName = "mongodb-destination";

export default MongodbDestination;
