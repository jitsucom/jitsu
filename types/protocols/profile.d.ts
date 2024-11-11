import { FunctionContext } from "./functions";
import { AnalyticsServerEvent } from "./analytics";

export type ProfileResult = {
  traits: Record<string, any>;
};

export type ProfileUser = {
  id?: string;
  anonymousId?: string;
  traits: Record<string, any>;
};

export type ProfileBuilderContext = {
  profileBuilder: {
    id: string;
    version: number;
  };
};

export type ProfileFunction = (
  events: Iterable<AnalyticsServerEvent>,
  user: ProfileUser,
  context: FunctionContext & ProfileBuilderContext
) => Promise<ProfileResult | undefined>;
