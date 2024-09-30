import { FunctionContext } from "./functions";
import { AnalyticsServerEvent } from "./analytics";

export type ProfileResult = {
  properties: Record<string, any>
}

export type ProfileFunction = (params: {
  context: FunctionContext;
  events: Iterable<AnalyticsServerEvent>;
  user:{
    id?: string;
    anonymousId?: string;
    traits: Record<string, any>;
  }
}) => Promise<ProfileResult>