export type EventsLogFilter = {
  start?: Date;
  end?: Date;
  filter?: (any) => boolean;
};

export type EventsLogRecord = {
  id: string;
  date: Date;
  /** Set when the log is queried across all the workspace's actors */
  actorId?: string;
  content: any;
};
