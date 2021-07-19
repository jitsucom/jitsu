import {
  generateId,
  generateRandom,
  getCookie,
  getCookieDomain,
  getCookies,
  getDataFromParams,
  getHostWithProtocol,
  parseQuery,
  reformatDate,
  setCookie
} from './helpers'
import {
  Event,
  EventCompat,
  EventCtx,
  EventPayload,
  EventSrc,
  JitsuClient,
  JitsuOptions,
  Transport,
  UserProps
} from './interface'
import { getLogger, setRootLogLevel } from './log';

const VERSION_INFO = {
  env: '__buildEnv__',
  date: '__buildDate__',
  version: '__buildVersion__'
}

const JITSU_VERSION = `${VERSION_INFO.version}/${VERSION_INFO.env}@${VERSION_INFO.date}`;

const xmlHttpReqTransport: Transport = (url: string, json: string): Promise<void> => {
  let req = new XMLHttpRequest();
  return new Promise((resolve, reject) => {
    req.onerror = (e) => {
      getLogger().error('Failed to send', json, e);
      reject(new Error(`Failed to send JSON. See console logs`))
    };
    req.onload = () => {
      if (req.status !== 200) {
        getLogger().warn(`Failed to send data to ${url} (#${req.status} - ${req.statusText})`, json);
        reject(new Error(`Failed to send JSON. Error code: ${req.status}. See logs for details`))
      }
      resolve();
    }
    req.open('POST', url);
    req.setRequestHeader('Content-Type', 'application/json');
    req.send(json)
    getLogger().debug('sending json', json);
  });
}

const beaconTransport: Transport = (url: string, json: string): Promise<void> => {
  getLogger().debug('Sending beacon', json);
  const blob = new Blob([json], { type: 'text/plain' });
  navigator.sendBeacon(url, blob);
  return Promise.resolve();
}

interface Persistence {
  save(props: Record<string, any>)
  restore(): Record<string, any> | undefined
}

class CookiePersistence implements Persistence {
  private cookieDomain: string;
  private cookieName: string;

  constructor(cookieDomain: string, cookieName: string) {
    this.cookieDomain = cookieDomain;
    this.cookieName = cookieName;
  }

  public save(props: Record<string, any>) {
    setCookie(this.cookieName, encodeURIComponent(JSON.stringify(props)), Infinity, this.cookieDomain, document.location.protocol !== 'http:');
  }

  restore(): Record<string, any> | undefined {
    let str = getCookie(this.cookieName);
    if (str) {
      try {
        const parsed = JSON.parse(decodeURIComponent(str));
        if (typeof parsed !== 'object') {
          getLogger().warn(`Can't restore value of ${this.cookieName}@${this.cookieDomain}, expected to be object, but found ${typeof parsed !== 'object'}: ${parsed}. Ignoring`)
          return undefined;
        }
        return parsed;
      } catch (e) {
        getLogger().error('Failed to decode JSON from ' + str, e);
        return undefined;
      }
    }
    return undefined;
  }
}

const defaultCompatMode = false;

export function jitsuClient(opts?: JitsuOptions): JitsuClient {
  let client = new JitsuClientImpl();
  client.init(opts);
  return client;
}

type PermanentProperties = {
  globalProps: Record<string, any>
  propsPerEvent: Record<string, Record<string, any>>
}

class JitsuClientImpl implements JitsuClient {
  private userIdPersistence?: Persistence;
  private propsPersistance?: Persistence;

  private anonymousId: string = '';
  private userProperties: UserProps = {}
  private permanentProperties: PermanentProperties = { globalProps: {}, propsPerEvent: {}}
  private cookieDomain: string = '';
  private trackingHost: string = '';
  private idCookieName: string = '';
  private randomizeUrl: boolean = false;

  private apiKey: string = '';
  private initialized: boolean = false;
  private _3pCookies: Record<string, boolean> = {};
  private initialOptions?: JitsuOptions;
  private compatMode: boolean;

  id(props: UserProps, doNotSendEvent?: boolean): Promise<void> {
    this.userProperties = { ...this.userProperties, ...props }
    getLogger().debug('Jitsu user identified', props)

    if (this.userIdPersistence) {
      this.userIdPersistence.save(props);
    } else {
      getLogger().warn('Id() is called before initialization')
    }
    if (!doNotSendEvent) {
      return this.track('user_identify', {});
    } else {
      return Promise.resolve();
    }
  }

  rawTrack(payload: any) {
    this.sendJson(payload);
  };

  getAnonymousId() {
    const idCookie = getCookie(this.idCookieName);
    if (idCookie) {
      getLogger().debug('Existing user id', idCookie);
      return idCookie;
    }
    let newId = generateId();
    getLogger().debug('New user id', newId);
    setCookie(this.idCookieName, newId, Infinity, this.cookieDomain, document.location.protocol !== 'http:');
    return newId;
  }

  makeEvent(event_type: string, src: EventSrc, payload: EventPayload): Event | EventCompat {
    this.restoreId();
    let context = this.getCtx();
    let persistentProps = {
      ...this.permanentProperties.globalProps,
      ...(this.permanentProperties.propsPerEvent[event_type] ?? {}),
    }
    let base = {
      api_key: this.apiKey,
      src,
      event_type,
      ...payload
    }

    return this.compatMode ?
      { ...persistentProps, eventn_ctx: context, ...base } :
      { ...persistentProps, ...context, ...base };
  }

  _send3p(sourceType: EventSrc, object: any, type?: string): Promise<any> {
    let eventType = '3rdparty'
    if (type && type !== '') {
      eventType = type
    }

    const e = this.makeEvent(eventType, sourceType, {
      src_payload: object
    });
    return this.sendJson(e);
  }

  sendJson(json: any): Promise<void> {
    let cookieLess = this.initialOptions?.id_method === 'cookie-less' ? '&cookie_less=true' : ''
    let privacyPolicy = this.initialOptions?.privacy_policy ? `&privacy_policy=${this.initialOptions.privacy_policy}` : ''
    let url = `${this.trackingHost}/api/v1/event?token=${this.apiKey}${cookieLess}${privacyPolicy}`;
    if (this.randomizeUrl) {
      url = `${this.trackingHost}/api.${generateRandom()}?p_${generateRandom()}=${this.apiKey}${cookieLess}${privacyPolicy}`;
    }

    let jsonString = JSON.stringify(json);
    if (this.initialOptions?.use_beacon_api && navigator.sendBeacon) {
      return beaconTransport(url, jsonString);
    } else {
      return xmlHttpReqTransport(url, jsonString);
    }
  }

  getCtx(): EventCtx {
    let now = new Date();
    return {
      event_id: '', //generate id on the backend side
      user: {
        anonymous_id: this.anonymousId,
        ...this.userProperties
      },
      ids: this._getIds(),
      user_agent: navigator.userAgent,
      utc_time: reformatDate(now.toISOString()),
      local_tz_offset: now.getTimezoneOffset(),
      referer: document.referrer,
      url: window.location.href,
      page_title: document.title,
      doc_path: document.location.pathname,
      doc_host: document.location.hostname,
      doc_search: window.location.search,
      screen_resolution: screen.width + 'x' + screen.height,
      vp_size: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0) + 'x' + Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
      user_language: navigator.language,
      doc_encoding: document.characterSet,
      ...getDataFromParams(parseQuery())
    };
  }

  private _getIds(): Record<string, string> {
    let cookies = getCookies(false);
    let res: Record<string, string> = {};
    for (let [key, value] of Object.entries(cookies)) {
      if (this._3pCookies[key]) {
        res[key.charAt(0) == '_' ?
          key.substr(1) :
          key] = value;
      }
    }
    return res;
  }

  track(type: string, payload?: EventPayload): Promise<void> {
    let data = payload || {};
    getLogger().debug('track event of type', type, data)
    const e = this.makeEvent(type, this.compatMode ?
      'eventn' :
      'jitsu', payload || {});
    return this.sendJson(e);
  }

  init(options: JitsuOptions) {
    if (options.log_level) {
      setRootLogLevel(options.log_level);
    }
    this.initialOptions = options;
    getLogger().debug('Initializing Jitsu Tracker tracker', options, JITSU_VERSION)
    if (!options.key) {
      getLogger().error('Can\'t initialize Jitsu, key property is not set');
      return;
    }
    this.compatMode = options.compat_mode === undefined ?
      defaultCompatMode :
      !!options.compat_mode;
    this.cookieDomain = options.cookie_domain || getCookieDomain();
    this.trackingHost = getHostWithProtocol(options['tracking_host'] || 't.jitsu.com');
    this.randomizeUrl = options.randomize_url || false;
    this.idCookieName = options.cookie_name || '__eventn_id';
    this.apiKey = options.key;

    this.userIdPersistence = new CookiePersistence(this.cookieDomain, this.idCookieName + '_usr');
    this.propsPersistance = new CookiePersistence(this.cookieDomain, this.idCookieName + '_props');

    if (this.propsPersistance) {
      const restored = this.propsPersistance.restore();
      if (restored) {
        this.permanentProperties = restored as PermanentProperties;
        this.permanentProperties.globalProps = restored.globalProps ?? {};
        this.permanentProperties.propsPerEvent = restored.propsPerEvent ?? {};
      }
      getLogger().debug('Restored persistent properties', this.permanentProperties);
    }

    if (options.capture_3rd_party_cookies === false) {
      this._3pCookies = {}
    } else {
      (options.capture_3rd_party_cookies || ['_ga', '_fbp', '_ym_uid', 'ajs_user_id', 'ajs_anonymous_id'])
        .forEach(name => this._3pCookies[name] = true)
    }

    if (options.ga_hook) {
      getLogger().warn('GA event interceptor isn\'t supported anymore')
    }
    if (options.segment_hook) {
      interceptSegmentCalls(this);
    }
    if (options.id_method !== 'cookie-less'){
      this.anonymousId = this.getAnonymousId();
    }
    this.initialized = true;
  }

  interceptAnalytics(analytics: any) {
    let interceptor = (chain: any) => {
      try {
        let payload = { ...chain.payload }
        getLogger().debug('Intercepted segment payload', payload.obj);

        let integration = chain.integrations['Segment.io']
        if (integration && integration.analytics) {
          let analyticsOriginal = integration.analytics
          if (typeof analyticsOriginal.user === 'function' && analyticsOriginal.user() && typeof analyticsOriginal.user().id === 'function') {
            payload.obj.userId = analyticsOriginal.user().id()
          }
        }
        if (payload?.obj?.timestamp) {
          payload.obj.sentAt = payload.obj.timestamp;
        }

        let type = chain.payload.type();
        if (type === 'track') {
          type = chain.payload.event()
        }

        this._send3p('ajs', payload, type);
      } catch (e) {
        getLogger().warn('Failed to send an event', e)
      }

      chain.next(chain.payload);
    };
    if (typeof analytics.addSourceMiddleware === 'function') {
      //analytics is fully initialized
      getLogger().debug('Analytics.js is initialized, calling addSourceMiddleware');
      analytics.addSourceMiddleware(interceptor);
    } else {
      getLogger().debug('Analytics.js is not initialized, pushing addSourceMiddleware to callstack');
      analytics.push(['addSourceMiddleware', interceptor])
    }
    analytics['__en_intercepted'] = true
  }

  private restoreId() {
    if (this.initialOptions?.id_method !== 'cookie-less') {
      if (this.userIdPersistence) {
        let props = this.userIdPersistence.restore();
        if (props) {
          this.userProperties = { ...props, ...this.userProperties };
        }
      }
    }
  }

  set(properties, opts?) {
    const eventType = opts?.eventType;
    const persist = opts?.persist === undefined || opts?.persist
    if (eventType !== undefined) {
      let current = this.permanentProperties.propsPerEvent[eventType] ?? {};
      this.permanentProperties.propsPerEvent[eventType] = {...current, ...properties};
    } else {
      this.permanentProperties.globalProps = {...this.permanentProperties.globalProps, ...properties};
    }

    if (this.propsPersistance && persist) {
      this.propsPersistance.save(this.permanentProperties);
    }
  }

  unset(propertyName: string, opts) {
    const eventType = opts?.eventType;
    const persist = opts?.persist === undefined || opts?.persist

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
