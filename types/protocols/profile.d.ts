import { FunctionContext } from "./functions";
import { AnalyticsServerEvent } from "./analytics";

export type ProfileResult = {
  profileId?: string;
  destinationId?: string;
  tableName?: string;
  traits: Record<string, any>;
};

export type ProfileUser = {
  profileId: string;
  userId?: string;
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
