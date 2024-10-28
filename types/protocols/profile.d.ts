import { FunctionContext } from "./functions";
import { AnalyticsServerEvent } from "./analytics";

export type ProfileResult = {
  properties: Record<string, any>;
};

export type ProfileFunction = (
  events: Iterable<AnalyticsServerEvent>,
  user: {
    id?: string;
    anonymousId?: string;
    traits: Record<string, any>;
  },
  context: FunctionContext
) => Promise<ProfileResult | undefined>;
