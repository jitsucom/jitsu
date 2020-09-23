export type Tracker = {
  send3p: (name: string, payload: any, subType?: string) => void
  track: (name: string, payload: any) => void
  id: (userData: Record<string, any>, doNotSendEvent: boolean) => void
  logger: Logger
  init?: (opts: TrackerOptions) => void
  interceptAnalytics: (t: Tracker, analytics: any) => void
}

export type Logger = {
  debug: (...args: any) => void
  info: (...args: any) => void
  warn: (...args: any) => void
  error: (...args: any) => void
}

export type TrackerOptions = {
  cookie_domain?: string
  tracking_host?: string
  cookie_name?: string
  key?: string
  logger?: Logger
  ga_hook?: boolean
  segment_hook?: boolean
};

interface UserProps {
  anonymous_id: string
  [propName: string]: any
}

export interface EventCtx {
  event_id: string
  user: UserProps
  user_agent: string
  utc_time: string
  local_tz_offset: number
  referer: string
  url: string
  page_title: string
  [propName: string]: any
}

export type Event = {
  api_key: string
  src: string
  event_type: string
  eventn_ctx: EventCtx
}

export type EventnEvent = Event & {
  eventn_data: any
  src: 'eventn'
}

export type ThirdPartyEvent = Event & {
  event_type: ''
  src_payload: any
}

export type TrackerPlugin = (t: Tracker) => void;
