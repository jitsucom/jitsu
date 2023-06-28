export type EventsLogFilter = {
  start?: string;
  end?: string;
  beforeId?: string;
  filter?: (any) => boolean;
};

export type EventsLogRecord = {
  id: string;
  date: Date;
  content: any;
};
