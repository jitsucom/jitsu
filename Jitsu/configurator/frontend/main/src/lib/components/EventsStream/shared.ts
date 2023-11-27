import { Moment } from "moment"

export enum EventType {
  Destination = "destination",
  Token = "token",
}

export enum EventStatus {
  All = "",
  Success = "success",
  Error = "error",
  Pending = "pending",
  Skip = "skip",
}

export type Event = {
  type: EventType
  timestamp: Moment
  id: string
  rawJson: any
  entityId: string
  status: EventStatus
  resultJson: any
}
