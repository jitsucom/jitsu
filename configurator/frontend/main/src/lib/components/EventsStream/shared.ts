import { Moment } from "moment"

export enum EventType {
  Destination = "destination",
  Token = "token",
}

export enum EventStatus {
  Success = "success",
  Error = "error",
  Pending = "pending",
  Skip = "skip",
}

export type Event = {
  type: EventType
  timestamp: Moment
  eventId: string
  rawJson: any
  id: string
  status: EventStatus
  resultJson: any
}
