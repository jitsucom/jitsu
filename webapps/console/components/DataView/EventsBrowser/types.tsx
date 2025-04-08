import { EventsLogRecord } from "../../../lib/server/events-log";

type StreamType = "incoming" | "function" | "bulker";
type Level = "all" | "error" | "info" | "debug" | "warn";
type DatesRange = [string | null, string | null];

export type EventsBrowserProps = {
  streamType: StreamType;
  level: Level;
  actorId: string;
  dates: DatesRange;
  search?: string;
  patchQueryStringState: (key: string, value: any) => void;
};

export type EventsBrowserState = {
  bulkerMode?: "stream" | "batch";
  eventsLoading: boolean;
  events?: EventsLogRecord[];
  initDate: Date;
  refreshTime: Date;
  previousRefreshTime?: Date;
  beforeDate?: Date;
  error?: string;
};

export const defaultState: EventsBrowserState = {
  bulkerMode: undefined,
  eventsLoading: false,
  events: undefined,
  beforeDate: undefined,
  refreshTime: new Date(),
  initDate: new Date(),
};
