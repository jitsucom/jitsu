import {
  deleteCookie,
  generateId,
  generateRandom,
  getCookie,
  getCookieDomain,
  getCookies,
  getDataFromParams,
  getHostWithProtocol,
  insertAndExecute,
  parseCookieString,
  parseQuery,
  reformatDate,
  setCookie,
} from "./helpers";
import {
  ClientProperties,
  Envs,
  Event,
  EventCompat,
  EventCtx,
  EventPayload,
  EventSrc,
  JitsuClient,
  JitsuOptions,
  Policy,
  TrackingEnvironment,
  UserProps,
} from "./interface";
import { getLogger, setRootLogLevel } from "./log";
import { isWindowAvailable, requireWindow } from "./window";
import { CookieOpts, serializeCookie } from "./cookie";
import { IncomingMessage, ServerResponse } from "http";
//import { parse } from "node-html-parser";

const VERSION_INFO = {
  env: "__buildEnv__",
  date: "__buildDate__",
  version: "__buildVersion__",
};

const JITSU_VERSION = `${VERSION_INFO.version}/${VERSION_INFO.env}@${VERSION_INFO.date}`;
let MAX_AGE_TEN_YEARS = 31_622_400 * 10;

const beaconTransport: Transport = (
  url: string,
  json: string
): Promise<void> => {
  getLogger().debug("Sending beacon", json);
  const blob = new Blob([json], { type: "text/plain" });
  navigator.sendBeacon(url, blob);
  return Promise.resolve();
};

function tryFormat(string: string): string {
  if (typeof string === "string") {
    try {
      return JSON.stringify(JSON.parse(string), null, 2);
    } catch (e) {
      return string;
    }
  }
}

const echoTransport: Transport = (url: string, json: string) => {
  console.log(`Jitsu client tried to send payload to ${url}`, tryFormat(json));
  return Promise.resolve();
};

// This is a hack to expire all cookies with non-root path left behind by invalid tracking.
// TODO remove soon
function expireNonRootCookies(name: string, path: string = undefined) {
  path = path ?? window.location.pathname
  if (path == "" || path == "/") {
    return
  }

  deleteCookie(name, path)
  expireNonRootCookies(name, path.slice(0, path.lastIndexOf("/")))
}

interface Persistence {
  save(props: Record<string, any>);

  restore(): Record<string, any> | undefined;

  delete();
}

class CookiePersistence implements Persistence {
  private cookieDomain: string;
  private cookieName: string;

  constructor(cookieDomain: string, cookieName: string) {
    this.cookieDomain = cookieDomain;
    this.cookieName = cookieName;
  }

  public save(props: Record<string, any>) {
    setCookie(this.cookieName, JSON.stringify(props), {
      domain: this.cookieDomain,
      secure: document.location.protocol !== "http:",
      maxAge: MAX_AGE_TEN_YEARS,
    });
  }

  restore(): Record<string, any> | undefined {
    expireNonRootCookies(this.cookieName)
    let str = getCookie(this.cookieName);
    if (str) {
      try {
        const parsed = JSON.parse(decodeURIComponent(str));
        if (typeof parsed !== "object") {
          getLogger().warn(
            `Can't restore value of ${this.cookieName}@${
              this.cookieDomain
            }, expected to be object, but found ${
              typeof parsed !== "object"
            }: ${parsed}. Ignoring`
          );
          return undefined;
        }
        return parsed;
      } catch (e) {
        getLogger().error("Failed to decode JSON from " + str, e);
        return undefined;
      }
    }
    return undefined;
  }

  delete() {
    deleteCookie(this.cookieName);
  }
}

class NoPersistence implements Persistence {
  public save(props: Record<string, any>) {}

  restore(): Record<string, any> | undefined {
    return undefined;
  }

  delete() {}
}

const defaultCompatMode = false;

export function jitsuClient(opts?: JitsuOptions): JitsuClient {
  let client = new JitsuClientImpl();
  client.init(opts);
  return client;
}

type PermanentProperties = {
  globalProps: Record<string, any>;
  propsPerEvent: Record<string, Record<string, any>>;
};

const browserEnv: TrackingEnvironment = {
  getSourceIp: () => undefined,
  describeClient: () => ({
    referer: document.referrer,
    url: window.location.href,
    page_title: document.title,
    doc_path: document.location.pathname,
    doc_host: document.location.hostname,
    doc_search: window.location.search,
    screen_resolution: screen.width + "x" + screen.height,
    vp_size:
      Math.max(
        document.documentElement.clientWidth || 0,
        window.innerWidth || 0
      ) +
      "x" +
      Math.max(
        document.documentElement.clientHeight || 0,
        window.innerHeight || 0
      ),
    user_agent: navigator.userAgent,
    user_language: navigator.language,
    doc_encoding: document.characterSet,
  }),

  getAnonymousId: ({ name, domain }) => {
    expireNonRootCookies(name)
    const idCookie = getCookie(name);
    if (idCookie) {
      getLogger().debug("Existing user id", idCookie);
      return idCookie;
    }
    let newId = generateId();
    getLogger().debug("New user id", newId);
    setCookie(name, newId, {
      domain,
      secure: document.location.protocol !== "http:",
      maxAge: MAX_AGE_TEN_YEARS,
    });
    return newId;
  },
};

function ensurePrefix(prefix: string, str?: string) {
  if (!str) {
    return str;
  }
  return str?.length > 0 && str.indexOf(prefix) !== 0 ? prefix + str : str;
}

function cutPostfix(postfixes: string | string[], str?: string) {
  for (const postfix of typeof postfixes === "string"
    ? [postfixes]
    : postfixes) {
    while (str && str.length > 0 && str.charAt(str.length - 1) === postfix) {
      str = str.substring(0, str.length - 1);
    }
  }
  return str;
}

export function fetchApi(
  req: Request,
  res: Response,
  opts: { disableCookies?: boolean } = {}
): TrackingEnvironment {
  return {
    getAnonymousId({ name, domain }): string {
      if (opts?.disableCookies) {
        return "";
      }

      const cookie = parseCookieString(req.headers["cookie"])[name];
      if (!cookie) {
        const cookieOpts: CookieOpts = {
          maxAge: 31_622_400 * 10,
          httpOnly: false,
        };
        if (domain) {
          cookieOpts.domain = domain;
        }
        let newId = generateId();
        res.headers.set("Set-Cookie", serializeCookie(name, newId, cookieOpts));
        return newId;
      } else {
        return cookie;
      }
    },
    getSourceIp() {
      let ip =
        req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req["ip"];
      return ip && ip.split(",")[0].trim();
    },
    describeClient(): ClientProperties {
      const requestHost = req.headers.get("host") || req.headers.get("host");
      let proto = cutPostfix(
        [":", "/"],
        req.headers["x-forwarded-proto"] || req["nextUrl"]["protocol"] || "http"
      );
      while (proto && proto.length > 0 && proto.charAt(proto.length - 1)) {
        proto = proto.substring(0, proto.length - 1);
      }
      let reqUrl = req.url || "/";
      let queryPos = reqUrl.indexOf("?");
      let path, query;
      if (queryPos >= 0) {
        path = reqUrl.substring(0, queryPos);
        query = reqUrl.substring(queryPos + 1);
      } else {
        path = reqUrl;
        query = undefined;
      }
      query = ensurePrefix(query, "?");
      path = ensurePrefix(path, "/");
      return {
        doc_encoding: "",
        doc_host: requestHost,
        doc_path: reqUrl,
        doc_search: query,
        page_title: "",
        referer: req.headers["referrer"],
        screen_resolution: "",
        url: `${proto}://${requestHost}${path || ""}${query || ""}`,
        user_agent: req.headers["user-agent"],
        user_language:
          req.headers["accept-language"] &&
          req.headers["accept-language"].split(",")[0],
        vp_size: "",
      };
    },
  };
}

export function httpApi(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { disableCookies?: boolean } = {}
): TrackingEnvironment {
  const header: (req: IncomingMessage, name: string) => string | undefined = (
    req,
    name
  ) => {
    let vals = req.headers[name.toLowerCase()];
    if (!vals) {
      return undefined;
    }
    if (typeof vals === "string") {
      return vals;
    } else if (vals.length > 0) {
      return vals.join(",");
    }
  };

  return {
    getAnonymousId({ name, domain }): string {
      if (opts?.disableCookies) {
        return "";
      }

      const cookie = parseCookieString(req.headers["cookie"])[name];
      if (!cookie) {
        const cookieOpts: CookieOpts = {
          maxAge: 31_622_400 * 10,
          httpOnly: false,
        };
        if (domain) {
          cookieOpts.domain = domain;
        }
        let newId = generateId();
        res.setHeader("Set-Cookie", serializeCookie(name, newId, cookieOpts));
        return newId;
      } else {
        return cookie;
      }
    },
    getSourceIp() {
      let ip =
        header(req, "x-forwarded-for") ||
        header(req, "x-real-ip") ||
        req.socket.remoteAddress;
      return ip && ip.split(",")[0].trim();
    },
    describeClient(): ClientProperties {
      let url: Partial<URL> = req.url
        ? new URL(
            req.url,
            req.url.startsWith("http") ? undefined : "http://localhost"
          )
        : {};
      const requestHost =
        header(req, "x-forwarded-host") || header(req, "host") || url.hostname;
      const proto = cutPostfix(
        [":", "/"],
        header(req, "x-forwarded-proto") || url.protocol
      );
      let query = ensurePrefix("?", url.search);
      let path = ensurePrefix("/", url.pathname);
      return {
        doc_encoding: "",
        doc_host: requestHost,
        doc_path: req.url,
        doc_search: query,
        page_title: "",
        referer: header(req, "referrer"),
        screen_resolution: "",
        url: `${proto}://${requestHost}${path || ""}${query || ""}`,
        user_agent: req.headers["user-agent"],
        user_language:
          req.headers["accept-language"] &&
          req.headers["accept-language"].split(",")[0],
        vp_size: "",
      };
    },
  };
}

const emptyEnv: TrackingEnvironment = {
  getSourceIp: () => undefined,
  describeClient: () => ({}),
  getAnonymousId: () => "",
};
/**
 * Dictionary of supported environments
 */
export const envs: Envs = {
  httpApi: httpApi,
  nextjsApi: httpApi,
  // fetchApi: fetchApi,
  // nextjsMiddleware: fetchApi,
  browser: () => browserEnv,
  express: httpApi,
  empty: () => emptyEnv,
};

const xmlHttpTransport: Transport = (
  url: string,
  jsonPayload: string,
  additionalHeaders: Record<string, string>,
  handler = (code, body) => {}
) => {
  let req = new window.XMLHttpRequest();
  return new Promise<void>((resolve, reject) => {
    req.onerror = (e) => {
      getLogger().error("Failed to send", jsonPayload, e);
      handler(-1, {});
      reject(new Error(`Failed to send JSON. See console logs`));
    };
    req.onload = () => {
      if (req.status !== 200) {
        handler(req.status, {});
        getLogger().warn(
          `Failed to send data to ${url} (#${req.status} - ${req.statusText})`,
          jsonPayload
        );
        reject(
          new Error(
            `Failed to send JSON. Error code: ${req.status}. See logs for details`
          )
        );
      } else {
        handler(req.status, req.responseText);
      }
      resolve();
    };
    req.open("POST", url);
    req.setRequestHeader("Content-Type", "application/json");
    Object.entries(additionalHeaders || {}).forEach(([key, val]) =>
      req.setRequestHeader(key, val)
    );
    req.send(jsonPayload);
    getLogger().debug("sending json", jsonPayload);
  });
};

const fetchTransport: (fetch: any) => Transport = (fetch) => {
  return async (
    url: string,
    jsonPayload: string,
    additionalHeaders: Record<string, string>,
    handler = (code, body) => {}
  ) => {
    let res: any;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(additionalHeaders || {}),
        },
        body: jsonPayload,
      });
    } catch (e) {
      getLogger().error("Failed to send", jsonPayload, e);
      handler(-1, {});
      throw new Error(`Failed to send JSON. See console logs`);
    }
    if (res.status !== 200) {
      getLogger().warn(
        `Failed to send data to ${url} (#${res.status} - ${res.statusText})`,
        jsonPayload
      );
      throw new Error(
        `Failed to send JSON. Error code: ${res.status}. See logs for details`
      );
    }
    let resJson = await res.json();
    handler(res.status, resJson);
  };
};

/**
 * Abstraction on top of HTTP calls. Implementation can be either based on XMLHttpRequest, Beacon API or
 * fetch (if running in Node env)
 *
 * Implementation should reject promise if request is unsuccessful. Parameters are:
 *    - url - URL
 *    - jsonPayload - POST payload. If not string, result should be converted to string with JSON.parse()
 *    - an optional handler that will be called in any case (both for failed and succesfull requests)
 */
export type Transport = (
  url: string,
  jsonPayload: string,
  additionalHeaders: Record<string, string>,
  handler?: (statusCode: number, responseBody: any) => void
) => Promise<void>;

class JitsuClientImpl implements JitsuClient {
  private userIdPersistence?: Persistence;
  private propsPersistance?: Persistence;

  private userProperties: UserProps = {};
  private permanentProperties: PermanentProperties = {
    globalProps: {},
    propsPerEvent: {},
  };
  private cookieDomain: string = "";
  private trackingHost: string = "";
  private idCookieName: string = "";
  private randomizeUrl: boolean = false;

  private apiKey: string = "";
  private initialized: boolean = false;
  private _3pCookies: Record<string, boolean> = {};
  private initialOptions?: JitsuOptions;
  private compatMode: boolean;
  private cookiePolicy: Policy = "keep";
  private ipPolicy: Policy = "keep";
  private beaconApi: boolean = false;
  private transport: Transport = xmlHttpTransport;
  private customHeaders: () => Record<string, string> = () => ({});

  id(props: UserProps, doNotSendEvent?: boolean): Promise<void> {
    this.userProperties = { ...this.userProperties, ...props };
    getLogger().debug("Jitsu user identified", props);

    if (this.userIdPersistence) {
      this.userIdPersistence.save(props);
    } else {
      getLogger().warn("Id() is called before initialization");
    }
    if (!doNotSendEvent) {
      return this.track("user_identify", {});
    } else {
      return Promise.resolve();
    }
  }

  rawTrack(payload: any) {
    return this.sendJson(payload);
  }

  makeEvent(
    event_type: string,
    src: EventSrc,
    payload: EventPayload
  ): Event | EventCompat {
    let { env, ...payloadData } = payload;
    if (!env) {
      env = isWindowAvailable() ? envs.browser() : envs.empty();
    }
    this.restoreId();
    let context = this.getCtx(env);

    let persistentProps = {
      ...this.permanentProperties.globalProps,
      ...(this.permanentProperties.propsPerEvent[event_type] ?? {}),
    };
    let base = {
      api_key: this.apiKey,
      src,
      event_type,
      ...payloadData,
    };
    let sourceIp = env.getSourceIp();
    if (sourceIp) {
      base["source_ip"] = sourceIp;
    }

    return this.compatMode
      ? { ...persistentProps, eventn_ctx: context, ...base }
      : { ...persistentProps, ...context, ...base };
  }

  _send3p(sourceType: EventSrc, object: any, type?: string): Promise<any> {
    let eventType = "3rdparty";
    if (type && type !== "") {
      eventType = type;
    }

    const e = this.makeEvent(eventType, sourceType, {
      src_payload: object,
    });
    return this.sendJson(e);
  }

  sendJson(json: any): Promise<void> {
    let cookiePolicy =
      this.cookiePolicy !== "keep" ? `&cookie_policy=${this.cookiePolicy}` : "";
    let ipPolicy =
      this.ipPolicy !== "keep" ? `&ip_policy=${this.ipPolicy}` : "";
    let urlPrefix = isWindowAvailable() ? "/api/v1/event" : "/api/v1/s2s/event";
    let url = `${this.trackingHost}${urlPrefix}?token=${this.apiKey}${cookiePolicy}${ipPolicy}`;
    if (this.randomizeUrl) {
      url = `${
        this.trackingHost
      }/api.${generateRandom()}?p_${generateRandom()}=${
        this.apiKey
      }${cookiePolicy}${ipPolicy}`;
    }
    let jsonString = JSON.stringify(json);
    getLogger().debug(`Sending payload to ${url}`, jsonString);
    return this.transport(url, jsonString, this.customHeaders(), (code, body) =>
      this.postHandle(code, body)
    );
  }

  postHandle(status: number, response: any): any {
    if (this.cookiePolicy === "strict" || this.cookiePolicy === "comply") {
      if (status === 200) {
        let data = response;
        if (typeof response === "string") {
          data = JSON.parse(response);
        }
        if (!data["delete_cookie"]) {
          return;
        }
      }
      this.userIdPersistence.delete();
      this.propsPersistance.delete();
      deleteCookie(this.idCookieName);
    }
    if (status === 200) {
      let data = response;
      if (typeof response === "string" && response.length > 0) {
        data = JSON.parse(response);
        let extras = data["jitsu_sdk_extras"];
        if (extras && extras.length > 0) {
          const isWindow = isWindowAvailable();
          if (!isWindow) {
            getLogger().error(
              "Tags destination supported only in browser environment"
            );
          } else {
            for (const { type, id, value } of extras) {
              if (type === "tag") {
                const tag = document.createElement("div");
                tag.id = id;
                insertAndExecute(tag, value);
                if (tag.childElementCount > 0) {
                  document.body.appendChild(tag);
                }
              }
            }
          }
        }
      }
    }
  }

  getCtx(env: TrackingEnvironment): EventCtx {
    let now = new Date();
    let props = env.describeClient() || {};
    return {
      event_id: "", //generate id on the backend
      user: {
        anonymous_id:
          this.cookiePolicy !== "strict"
            ? env.getAnonymousId({
                name: this.idCookieName,
                domain: this.cookieDomain,
              })
            : "",
        ...this.userProperties,
      },
      ids: this._getIds(),
      utc_time: reformatDate(now.toISOString()),
      local_tz_offset: now.getTimezoneOffset(),
      ...props,
      ...getDataFromParams(parseQuery(props.doc_search)),
    };
  }

  private _getIds(): Record<string, string> {
    if (!isWindowAvailable()) {
      return {};
    }
    let cookies = getCookies(false);
    let res: Record<string, string> = {};
    for (let [key, value] of Object.entries(cookies)) {
      if (this._3pCookies[key]) {
        res[key.charAt(0) == "_" ? key.substr(1) : key] = value;
      }
    }
    return res;
  }

  track(type: string, payload?: EventPayload): Promise<void> {
    let data = payload || {};
    getLogger().debug("track event of type", type, data);
    const e = this.makeEvent(
      type,
      this.compatMode ? "eventn" : "jitsu",
      payload || {}
    );
    return this.sendJson(e);
  }

  init(options: JitsuOptions) {
    if (isWindowAvailable() && !options.force_use_fetch) {
      if (options.fetch) {
        getLogger().warn(
          "Custom fetch implementation is provided to Jitsu. However, it will be ignored since Jitsu runs in browser"
        );
      }
      this.transport = this.beaconApi ? beaconTransport : xmlHttpTransport;
    } else {
      if (!options.fetch && !globalThis.fetch) {
        throw new Error(
          "Jitsu runs in Node environment. However, neither JitsuOptions.fetch is provided, nor global fetch function is defined. \n" +
            "Please, provide custom fetch implementation. You can get it via node-fetch package"
        );
      }
      this.transport = fetchTransport(options.fetch || globalThis.fetch);
    }

    if (
      options.custom_headers &&
      typeof options.custom_headers === "function"
    ) {
      this.customHeaders = options.custom_headers;
    } else if (options.custom_headers) {
      this.customHeaders = () =>
        options.custom_headers as Record<string, string>;
    }

    if (options.tracking_host === "echo") {
      getLogger().warn(
        'jitsuClient is configured with "echo" transport. Outgoing requests will be written to console'
      );
      this.transport = echoTransport;
    }

    if (options.ip_policy) {
      this.ipPolicy = options.ip_policy;
    }
    if (options.cookie_policy) {
      this.cookiePolicy = options.cookie_policy;
    }
    if (options.privacy_policy === "strict") {
      this.ipPolicy = "strict";
      this.cookiePolicy = "strict";
    }
    if (options.use_beacon_api && navigator.sendBeacon) {
      this.beaconApi = true;
    }

    //can't handle delete cookie response when beacon api
    if (this.cookiePolicy === "comply" && this.beaconApi) {
      this.cookiePolicy = "strict";
    }
    if (options.log_level) {
      setRootLogLevel(options.log_level);
    }
    this.initialOptions = options;
    getLogger().debug(
      "Initializing Jitsu Tracker tracker",
      options,
      JITSU_VERSION
    );
    if (!options.key) {
      getLogger().error("Can't initialize Jitsu, key property is not set");
      return;
    }
    this.compatMode =
      options.compat_mode === undefined
        ? defaultCompatMode
        : !!options.compat_mode;
    this.cookieDomain = options.cookie_domain || getCookieDomain();
    this.trackingHost = getHostWithProtocol(
      options["tracking_host"] || "t.jitsu.com"
    );
    this.randomizeUrl = options.randomize_url || false;
    this.idCookieName = options.cookie_name || "__eventn_id";
    this.apiKey = options.key;

    if (this.cookiePolicy === "strict") {
      this.propsPersistance = new NoPersistence();
    } else {
      this.propsPersistance = isWindowAvailable()
        ? new CookiePersistence(this.cookieDomain, this.idCookieName + "_props")
        : new NoPersistence();
    }

    if (this.cookiePolicy === "strict") {
      this.userIdPersistence = new NoPersistence();
    } else {
      this.userIdPersistence = isWindowAvailable()
        ? new CookiePersistence(this.cookieDomain, this.idCookieName + "_usr")
        : new NoPersistence();
    }

    if (this.propsPersistance) {
      const restored = this.propsPersistance.restore();
      if (restored) {
        this.permanentProperties = restored as PermanentProperties;
        this.permanentProperties.globalProps = restored.globalProps ?? {};
        this.permanentProperties.propsPerEvent = restored.propsPerEvent ?? {};
      }
      getLogger().debug(
        "Restored persistent properties",
        this.permanentProperties
      );
    }

    if (options.capture_3rd_party_cookies === false) {
      this._3pCookies = {};
    } else {
      (
        options.capture_3rd_party_cookies || [
          "_ga",
          "_fbp",
          "_ym_uid",
          "ajs_user_id",
          "ajs_anonymous_id",
        ]
      ).forEach((name) => (this._3pCookies[name] = true));
    }

    if (options.ga_hook) {
      getLogger().warn("GA event interceptor isn't supported anymore");
    }
    if (options.segment_hook) {
      interceptSegmentCalls(this);
    }
    this.initialized = true;
  }

  interceptAnalytics(analytics: any) {
    let interceptor = (chain: any) => {
      try {
        let payload = { ...chain.payload };
        getLogger().debug("Intercepted segment payload", payload.obj);

        let integration = chain.integrations["Segment.io"];
        if (integration && integration.analytics) {
          let analyticsOriginal = integration.analytics;
          if (
            typeof analyticsOriginal.user === "function" &&
            analyticsOriginal.user() &&
            typeof analyticsOriginal.user().id === "function"
          ) {
            payload.obj.userId = analyticsOriginal.user().id();
          }
        }
        if (payload?.obj?.timestamp) {
          payload.obj.sentAt = payload.obj.timestamp;
        }

        let type = chain.payload.type();
        if (type === "track") {
          type = chain.payload.event();
        }

        this._send3p("ajs", payload, type);
      } catch (e) {
        getLogger().warn("Failed to send an event", e);
      }

      chain.next(chain.payload);
    };
    if (typeof analytics.addSourceMiddleware === "function") {
      //analytics is fully initialized
      getLogger().debug(
        "Analytics.js is initialized, calling addSourceMiddleware"
      );
      analytics.addSourceMiddleware(interceptor);
    } else {
      getLogger().debug(
        "Analytics.js is not initialized, pushing addSourceMiddleware to callstack"
      );
      analytics.push(["addSourceMiddleware", interceptor]);
    }
    analytics["__en_intercepted"] = true;
  }

  private restoreId() {
    if (this.userIdPersistence) {
      let props = this.userIdPersistence.restore();
      if (props) {
        this.userProperties = { ...props, ...this.userProperties };
      }
    }
  }

  set(properties, opts?) {
    const eventType = opts?.eventType;
    const persist = opts?.persist === undefined || opts?.persist;
    if (eventType !== undefined) {
      let current = this.permanentProperties.propsPerEvent[eventType] ?? {};
      this.permanentProperties.propsPerEvent[eventType] = {
        ...current,
        ...properties,
      };
    } else {
      this.permanentProperties.globalProps = {
        ...this.permanentProperties.globalProps,
        ...properties,
      };
    }

    if (this.propsPersistance && persist) {
      this.propsPersistance.save(this.permanentProperties);
    }
  }

  unset(propertyName: string, opts) {
    requireWindow();
    const eventType = opts?.eventType;
    const persist = opts?.persist === undefined || opts?.persist;

    if (!eventType) {
      delete this.permanentProperties.globalProps[propertyName];
    } else if (this.permanentProperties.propsPerEvent[eventType]) {
      delete this.permanentProperties.propsPerEvent[eventType][propertyName];
    }
    if (this.propsPersistance && persist) {
      this.propsPersistance.save(this.permanentProperties);
    }
  }
}

function interceptSegmentCalls(t: JitsuClient) {
  let win = window as any;
  if (!win.analytics) {
    win.analytics = [];
  }
  t.interceptAnalytics(win.analytics);
}
