import { Moment } from "moment"

export type Event = {
  time: Moment
  eventId: string
  destinations: Record<string, any>
}

export type RawEvent = {
  original: {
    _timestamp: string
    eventn_ctx_event_id: string
    [key: string]: any
  }
  success: SuccessEvent
}

export type SuccessEvent = {
  destination_id: string
  [key: string]: any
}

interface TableSuccessEvent extends SuccessEvent {}
