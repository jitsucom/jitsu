/**
 * Interface for logging. Plugins might use it
 * internally
 */
export type Logger = {
  debug: (...args: any) => void
  info: (...args: any) => void
  warn: (...args: any) => void
  error: (...args: any) => void
}


/**
 * Main EventNative tracker inteface
 */
export type Tracker = {
  logger: Logger
  /**
   * Sends a third-party event (event intercepted from third-party system, such as analytics.js or GA). Should
   * not be called directly
   * @param typeName event name of event
   * @param payload third-party payload
   * @param type event-type
   */
  send3p: (typeName: string, payload: any, type?: string) => void
  /**
   * Sends a track event to server
   * @param name event name
   * @param payload event payload
   */
  track: (typeName: string, payload: any) => void
  /**
   * Sets a user data
   * @param userData user data (as map id_type --> value, such as "email": "a@bcd.com"
   * @param doNotSendEvent if true (false by default), separate "id" event won't be sent to server
   */
  id: (userData: Record<string, any>, doNotSendEvent?: boolean) => void
  /**
   * Initializes tracker. Must be called
   * @param initialization options
   */
  init?: (opts: TrackerOptions) => void
  /**
   * Explicit call for intercepting segment's analytics.
   * @param analytics window.analytics object
   */
  interceptAnalytics: (analytics: any) => void
}

/**
 * Configuration options of EventNative
 */
export type TrackerOptions = {
  cookie_domain?: string
  tracking_host?: string
  cookie_name?: string
  key?: string
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

export type TrackerPlugin = (t: Tracker) => void;
