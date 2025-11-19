export type DeadLetterFilter = {
  start?: Date;
  end?: Date;
  filter?: (any) => boolean;
};

export type DeadLetterRecord = {
  date: Date;
  workspaceId: string;
  actorId: string;
  type: string;
  payload: any;
  error: any;
};
