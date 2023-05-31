export type EventsLogFilter = {
  start?: Date;
  end?: Date;
  beforeId?: string;
  filter?: (any) => boolean;
};

export type EventsLogRecord = {
  id: string;
  date: Date;
  content: any;
};
