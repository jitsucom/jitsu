export declare function jitsuClient(opts: JitsuOptions): JitsuClient

export type JitsuClient = {
  /**
   * Sends a third-party event (event intercepted from third-party system, such as analytics.js or GA). Should
   * not be called directly
   * @param typeName event name of event
   * @param _3pData third-party payload. The structure depend on
   * @param type event-type
   * @return promise that is resolved after executed.
   *         However, if beacon API is used (see TrackerOption.use_beacon) promise will be resolved immediately
   */
  _send3p: (typeName: EventSrc, _3pPayload: any, type?: string) => Promise<void>
  /**
   * Sends a track event to server
   * @param name event name
   * @param payload event payload
   * @return Promise, see _send3p documentation
   */
  track: (typeName: string, payload?: EventPayload) => Promise<void>

  // /**
  //  * Similar to track(), but send unstructured payload to EventNative processing pipeline. No
  //  * additional detection (user-agent, url and so on will be done). No payload structure is enforced
  //  * @param payload
  //  */
  rawTrack: (payload: any) => Promise<void>

  /**
   * Sets a user data
   * @param userData user data (as map id_type --> value, such as "email": "a@bcd.com"
   * @param doNotSendEvent if true (false by default), separate "id" event won't be sent to server
   * @return Promise, see _send3p documentation
   */
  id: (userData: UserProps, doNotSendEvent?: boolean) => Promise<void>
  /**
   * Initializes tracker. Must be called
   * @param initialization options
   */
  init: (opts: JitsuOptions) => void

  /**
   * Explicit call for intercepting Segment's analytics.
   * @param analytics window.analytics object
   */
  interceptAnalytics: (analytics: any) => void

  /**
   * Sets a permanent properties that will be persisted across sessions. On every track() call those properties
   * will be merged with `payload` parameter
   * @param properties properties
   * @param opts options.
   *    eventType - apply permanent properties to only certain event type (applied to all types by default)
   *    persist - persist properties across sessions (in cookies). True by default
   */
  set(properties: Record<string, any>, opts?: { eventType?: string, persist?: boolean });

  /**
   * User
   */
  unset(propertyName: string, opts: { eventType?: string, persist?: boolean });

}

/**
 * Type of jitsu function which is exported to window.jitsu when tracker is embedded from server
 */
export type JitsuFunction = (action: 'track' | 'id' | 'set', eventType: string, payload?: EventPayload) => void;

/**
 * User identification method:
 *  - cookie (based on cookie)
 *  - ls (localstorage)
 *  Currently only 'cookie' is supported
 */
export type IdMethod = 'cookie' | 'ls'

/**
 * Policy configuration affects cookies storage and IP handling.
 *  - strict: Jitsu doesn't store cookies and replaces last octet in IP address (10.10.10.10 -> 10.10.10.1)
 *  - keep: Jitsu uses cookies for user identification and saves full IP
 *  - comply: Jitsu checks customer country and tries to comply with Regulation laws (such as GDPR, UK's GDPR (PECR) and California's GDPR (CCPA)
 */
export type Policy = 'strict' | 'keep' | 'comply'

/**
 * Configuration options of Jitsu
 */
export type JitsuOptions = {

  /**
   * A custom fetch implementation. Here's how Jitsu decides what functions to use to execute HTTP requests
   *
   * - If Jitsu runs in browser, this parameter will be ignored. The best available API (most likely, XMLHttpRequest)
   *   will be used for sending reqs
   * - For node Jitsu will use this param. If it's not set, Jitsu will try to search for fetch in global environment
   *   and will fail if it's absent
   *
   *
   *
   */
  fetch?: any,

  /**
   * Forces Jitsu SDK to use the fetch implementation (custom or default) even in browser
   */
  force_use_fetch?: any,

  /**
   * If Jitsu should work in compatibility mode. If set to true:
   *  - event_type will be set to 'eventn' instead of 'jitsu'
   *  - EventCtx should be written in eventn_ctx node as opposed to to event root
   */
  compat_mode?: boolean

  /**
   * If beacon API (https://developer.mozilla.org/en-US/docs/Web/API/Beacon_API) should be used instead of
   * XMLHttpRequest.
   *
   * Warning: beacon API might be unstable (https://volument.com/blog/sendbeacon-is-broken). Please,
   * do not use it unless absolutely necessary
   */
  use_beacon_api?: boolean

  /**
   * Cookie domain that will be used to identify
   * users. If not set, location.hostname will be used
   */
  cookie_domain?: string
  /**
   * Tracking host (where API calls will be sent). If not set,
   * we'd try to do the best to "guess" it. Last resort is t.jitsu.com.
   *
   * Though this parameter is not required, it's highly recommended to set is explicitly
   */
  tracking_host?: string

  /**
   * Name of id cookie. __eventn_id by default
   */
  cookie_name?: string
  /**
   * API key. It's highly recommended to explicitely set it. Otherwise, the code will work
   * in some cases (where server is configured with exactly one client key)
   */
  key: string
  /**
   * If google analytics events should be intercepted. Read more about event interception
   * at https://docs.eventnative.org/sending-data/javascript-reference/events-interception
   *
   * @default false
   */
  ga_hook?: boolean
  /**
   * If google analytics events should be intercepted. Read more about event interception
   * at https://docs.eventnative.org/sending-data/javascript-reference/events-interception
   *
   * @default false
   */
  segment_hook?: boolean
  /**
   * If URL of API server call should be randomize to by-pass adblockers
   *
   * @default false
   */
  randomize_url?: boolean

  /**
   * If Jitsu should capture third-party cookies: either array
   * of cookies name or false if the features should be disabled
   *
   * @default GA/Segment/Fb cookies: ['_ga': '_fbp', '_ym_uid', 'ajs_user_id', 'ajs_anonymous_id']
   */
  capture_3rd_party_cookies?: string[] | false;

  /**
   * See comment on IdMethod. Currently only 'cookie' and 'cookie-less' are supported
   */
  id_method?: IdMethod

  /**
   * Privacy policy configuration makes all policies strict to comply with the cookies law. If set to 'strict'
   * ip_policy = 'strict' and cookie_policy = 'strict' will be set.
   * Currently only 'strict' is supported
   */
  privacy_policy?: 'strict'

  /**
   * IP policy see Policy
   */
  ip_policy?: Policy

  /**
   * Cookie policy see Policy
   */
  cookie_policy?: Policy

  /**
   * Log level. 'WARN' if not set
   */
  log_level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE';

  /**
   * Headers that should be added to each request. Could be either static dict or function that returns the dict
   */
  custom_headers?: Record<string, string> | (() => Record<string, string>)

  //NOTE: If any property is added here, please make sure it's added to browser.ts jitsuProps as well
};

/**
 * User properties (ids).
 */
export interface UserProps {
  anonymous_id?: string             //anonymous is (cookie or ls based),
  id?: string                       //user id (non anonymous). If not set, first known id (from propName below) will be used
  email?: string                    //user id (non anonymous). If not set, first known id (from propName below) will be used
  [propName: string]: any           //any other forms of ids
}

/**
 * Ids for third-party tracking systems
 */
export type ThirdpartyIds = {
  [id: string]: string
}

export type Conversion = {
  //The purpose of this set is mainly to minic GA's set of parameters
  //(see https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters)

  transaction_id?: string | number  //id of transaction
  affiliation?: string | number     //affiliation id
  revenue?: number                  //revenue
  currency?: string                 //currency
  shipping_cost?: number            //shipping cost
  tax?: number                      //tax cost

}


/**
 * Event context. Data that is present in any event type. EventContext is assembled automatically
 */
export type EventCtx = {
  event_id: string                 //unique event id or empty string for generating id on the backend side
  user: UserProps                  //user properties
  ids?: ThirdpartyIds              //user ids from external systems
  utc_time: string                 //current UTC time in ISO 8601
  local_tz_offset: number          //local timezone offset (in minutes)

  utm: Record<string, string>      //utm tags (without utm prefix, e.g key will be "source", not utm_source. See
  click_id: Record<string, string> //all external click ids (passed through URL). See CLICK_IDS for supported all supported click ids
  [propName: string]: any          //context is extendable, any extra properties can be added here
}


/**
 * Tracking environment. Encapsulates environment such as Node browser or
 */
export type TrackingEnvironment = {
  /**
   * Describes "client": page title, url, etc. See type definition
   */
  describeClient(): Partial<ClientProperties>;
  /**
   * Returns source ip. If IP should be resolved by Jitsu server, this method should return undefined
   */
  getSourceIp(): string | undefined;

  /**
   * Gets (and persists) anonymous id. Example implementation: id can be persisted in cookies or in other way.
   *
   */
  getAnonymousId(cookieOpts: { name: string, domain?: string }): string;
};
/**
 * List of environments where Jitsu tracker can work. See TrackingEnvironment above
 * to learn what is the environment
 */
export type Envs = {
  // /**
  //  * Environment where requests and responses are based on fetch API Request & Response object.
  //  * Example: NextJS Middleware (https://nextjs.org/docs/middleware) is based on this API
  //  */
  // fetchApi(req, res);
  // /**
  //  * Alias of fetchApi
  //  */
  // nextjsMiddleware(req, res);

  /**
   * Environment where requests and responses are based on core Node.js http APIs (IncomingMessage and Server Response)
   * Example: NextJS APIs (except Middleware) is based on this one, or Express
   */
  httpApi(req, res);
  /**
   * Alias of httpApi
   */
  nextjsApi(req, res);
  /**
   * Alias of httpApi. For requests handled by Express
   */
  express(req, res);
  /**
   * Browser environment (based on window, document and etc globals)
   */
  browser();
  /**
   * Empty environment
   */
  empty();
}

declare const envs: Envs;


/**
 * Environment where the event have happened.
 */
export type ClientProperties = {
  screen_resolution: string        //screen resolution
  user_agent: string               //user
  referer: string                  //document referer
  url: string                      //current url
  page_title: string               //page title
                                   //see UTM_TYPES for all supported utm tags
  doc_path: string                 //document path
  doc_host: string                 //document host
  doc_search: string               //document search string

  vp_size: string                  //viewport size
  user_language: string            //user language
  doc_encoding: string
}

/**
 * Optional data that can be added to each event. Consist from optional fields,
 */
export type EventPayload = Partial<ClientProperties> & {
  /**
   * If track() is called in node env, it's possible to provide
   * request/response. In this case Jitsu will try to use it for
   * getting request data (url, referer and etc). Also, it will be used for
   * setting and getting cookies
   */
  req?: Request
  res?: Response
  env?: TrackingEnvironment

  conversion?: Conversion          //Conversion data if events indicates a conversion
  src_payload?: any,               //Third-party payload if event is intercepted from third-party source
  [propName: string]: any          //payload is extendable, any extra properties can be added here
}

/**
 * Type of event source
 */
export type EventSrc =
  'jitsu'    |                     //event came directly from Jitsu
  'eventn'   |                     //same as jitsu but for 'compat' mode, see
  'ga'       |                     //event is intercepted from GA
  '3rdparty' |                     //event is intercepted from 3rdparty source
  'ajs';                           //event is intercepted from analytics.js

/**
 * Basic information about the event
 */
export type EventBasics = {
  source_ip?: string               //IP address. Do not set this field on a client side, it will be rewritten on the server
  anon_ip?: string                 //First 3 octets of an IP address. Same as IP - will be set on a server
  api_key: string                  //JS api key
  src: EventSrc                    //Event source
  event_type: string               //event type
}

/**
 * Event object. A final object which is send to server
 */
export type Event = EventBasics & EventPayload & EventCtx;

/**
 * Event object, if tracker works in compatibility mode
 */
export type EventCompat = EventBasics & {
  eventn_ctx: EventCtx
} & EventPayload;

