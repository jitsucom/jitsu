import type { AnalyticsInterface } from "@jitsu/protocols/analytics";

type JitsuOptions = {
  /**
   * API Key. Optional. If not set, Jitsu will send event to the server without auth, and server
   * will link the call to configured source by domain name
   */
  writeKey?: string;
  /**
   * API Host. Default value: same host as script origin
   */
  host?: string;
  /**
   * To enable debug logging
   */
  debug?: boolean;
  /**
   * Explicitly specify cookie domain. If not set, cookie domain will be set to top level
   * of the current domain. Example: if JS lives on "app.example.com", cookie domain will be
   * set to ".example.com". If it lives on "example.com", cookie domain will be set to ".example.com" too
   */
  cookieDomain?: string;
  /**
   * Provide fetch implementation. It is required if you want to use Jitsu in NodeJS
   */
  fetch?: typeof fetch;
  /**
   * Which runtime to use. Runtime is used for obtaining context of the event: cookes,
   * url, etc. At the moment, Jitsu supports browser runtime and NodeJS runtime, but you
   * can provide your own implementation.
   *
   * If it's not set, the runtime will be detected automatically by presense of `window` object
   */
  runtime?: RuntimeFacade;
  /**
   * If set to true, jitsu will output events in console. In this case you don't need to set
   * writeKey / host. It's useful for debugging development environment
   */
  echoEvents?: boolean;

  /**
   * If true, events will go to s2s endpoints like ${host}/api/s/s2s/{type}. Otherwise they'll go to ${host}/api/s/{type}.
   *
   * If not set at all, it will be detected automatically by presence of `window` object
   */
  s2s?: boolean;

  /**
   * Timeout for fetch requests. Default value: 5000
   */
  fetchTimeoutMs?: number;

  /**
   * Endpoint that makes sure that Jitsu anonymousId cookie is set as server (httpOnly) cookie.
   * Endpoint must be hosted on the same domain as the site where Jitsu code is installed.
   * Required to overcome Safari ITP restrictions.
   */
  idEndpoint?: string;
};

type PersistentStorage = {
  getItem: (key: string, options?: any) => any;
  setItem: (key: string, value: any, options?: any) => void;
  removeItem: (key: string, options?: any) => void;
  reset: () => void;
};

type RuntimeFacade = {
  store(): PersistentStorage;
  userAgent(): string | undefined;
  language(): string | undefined;
  pageUrl(): string | undefined;
  documentEncoding(): string | undefined;
  getCookie(name: string): string | undefined;
  getCookies(): Record<string, string>;

  timezoneOffset(): number | undefined;
  screen():
    | {
        width: number;
        height: number;
        innerWidth: number;
        innerHeight: number;
        density: number;
      }
    | undefined;
  referrer(): string | undefined;
  pageTitle(): string | undefined;
};

export declare function jitsuAnalytics(opts: JitsuOptions): AnalyticsInterface;

export { AnalyticsInterface, JitsuOptions, PersistentStorage, RuntimeFacade };
