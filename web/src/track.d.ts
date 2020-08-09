type IEventN = {
  id: (userProperties: any, doNotSendEvent: boolean) => void
  track: (event_type: string, event_data: any) => void
  init: (options: {
    key: string,
    cookie_domain?: string
    tracking_host?: string
    cookie_name?: string
    segment_hook?: boolean
    ga_hook?: boolean
  }) => void
}
export const eventN: IEventN
