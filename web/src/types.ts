export interface IEventnTracker {
  send3p: (name: string, payload: any) => void
  track: (name: string, payload: any) => void
  id: (userData: Record<string, any>, doNotSendEvent: boolean) => void
  logger: ILogger
}

export interface ILogger {
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
  logger?: ILogger
};

export type TrackerPlugin = (t: IEventnTracker) => void;
