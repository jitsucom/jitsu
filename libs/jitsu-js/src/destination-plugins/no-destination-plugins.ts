import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";

export type InternalPlugin<T> = {
  id: string;
  handle(config: T & { debug?: boolean }, payload: AnalyticsClientEvent): Promise<void>;
};

export const internalDestinationPlugins: Record<string, InternalPlugin<any>> = {};
