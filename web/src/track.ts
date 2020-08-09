type FunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];
type FunctionProperties<T> = Pick<T, FunctionPropertyNames<T>>;

export type IEvents<T = FunctionProperties<EventnTracker>> = [T, ...any[]]
export type IEventBase = {
  initialized?: boolean
  eventsQ?: IEvents[]
  
}


export type IOptions = {
  key: string,
  cookie_domain?: string
  tracking_host?: string
  cookie_name?: string
  segment_hook?: boolean
  ga_hook?: boolean
}
export type IEventN = Required<IEventBase> & {
  id: (userProperties: Object, doNotSendEvent: boolean) => void
  track: (event_type: string, event_data: any) => void
  init: (options: IOptions) => void
  dropLastGAEvent?: boolean
  dropLastSegmentEvent?: boolean
}


const eventnObject = ((window.eventN === undefined) ? (window.eventN = {}) : window.eventN) as IEventN;
if (!eventnObject.eventsQ) {
  eventnObject.eventsQ = [];
}

export type debugName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const UTM_PREFIX = "utm_";
const UTM_TYPES = ['source', 'medium', 'campaign', 'term', 'content']
const CLICK_IDS = ['gclid', 'fbclid']
const MAX_CALL_WAIT = 100 // 10 call = 1s

class Log {
  level: debugName = window.eventnLogLevel ? window.eventnLogLevel : 'WARN'
  _levels: Record<debugName, number> = { 'DEBUG': 0, 'INFO': 1, 'WARN': 2, 'ERROR': 3 }
  debug: (str: string, ...context: any[]) => void
  info: (str: string, ...context: any[]) => void
  warn: (str: string, ...context: any[]) => void
  error: (str: string, ...context: any[]) => void
  log = (level: debugName, msg: string, ...context: any[]) => {
    if (console.log && this._levels[level] !== undefined && this._levels[level] >= this._levels[LOG.level]) {
      let fullMsg = `eventn - [${level.padEnd(5, ' ')}]: ${msg}, `;
      console.log(fullMsg, ...context)
    }
  }
  
  constructor() {
    for (let level in this._levels) {
      this[level.toLowerCase()] = (...args: [string, any]) => {
        this.log(level as debugName, ...args);
      }
    }
  }
}

const LOG = new Log()
LOG.log('DEBUG', 'Log system initialized');

class CookiesAccessor {
  getItem(name) {
    if (!name) {
      return null;
    }
    return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(name).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1")) || null;
  }
  
  setItem(name, value, expire, domain, secure) {
    if (!name || /^(?:expires|max\-age|path|domain|secure)$/i.test(name)) {
      LOG.warn("prohibited cookie name " + name);
      return false;
    }
    let expireString = "";
    if (expire) {
      switch (expire.constructor) {
        case Number:
          expireString = expire === Infinity ? "; expires=Fri, 31 Dec 9999 23:59:59 GMT" : "; max-age=" + expire;
          break;
        case String:
          expireString = "; expires=" + expire;
          break;
        case Date:
          expireString = "; expires=" + expire.toUTCString();
          break;
      }
    }
    document.cookie = encodeURIComponent(name) + "=" + value + expireString + (domain ? "; domain=" + domain : "") + (secure ? "; secure" : "");
    return true;
  }
  
  removeItem(key, domain) {
    if (!this.hasItem(key)) {
      return false;
    }
    document.cookie = encodeURIComponent(key) + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT" + (domain ? "; domain=" + domain : "");
    return true;
  }
  
  hasItem(key) {
    if (!name || /^(?:expires|max\-age|path|domain|secure)$/i.test(name)) {
      LOG.warn("prohibited cookie name " + name);
      return false;
    }
    return (new RegExp("(?:^|;\\s*)" + encodeURIComponent(key).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=")).test(document.cookie);
  }
  
  allNames() {
    let keys = document.cookie.replace(/((?:^|\s*;)[^\=]+)(?=;|$)|^\s*|\s*(?:\=[^;]*)?(?:\1|$)/g, "").split(/\s*(?:\=[^;]*)?;\s*/);
    for (let len = keys.length, idx = 0; idx < len; idx++) {
      keys[idx] = decodeURIComponent(keys[idx]);
    }
    return keys;
  }
}

class EventnTracker {
  key: string;
  cookieDomain: string;
  trackingHost: string;
  idCookieName: string;
  anonymousId: string;
  userProperties: Record<string, any>;
  apiKey: string | 'NONE';
  allOptions: IOptions;
  
  init(options: IOptions) {
    this.key = options['key'];
    this.cookieDomain = options['cookie_domain'] || this.getCookieDomain();
    this.trackingHost = options['tracking_host'] || 'track.ksense.io';
    this.idCookieName = options['cookie_name'] || '__eventn_id';
    this.anonymousId = this.getAnonymousId();
    this.userProperties = {}
    this.apiKey = options['key'] || 'NONE';
    this.allOptions = options;
    this.wait('analytics', this.initSegmentIntegration);
    this.wait('ga', this.initGAIntegration);
  }
  
  wait(target: string, cb: () => void) {
    function chek(): boolean {
      return !!window[target]
    }
    
    if (chek()) {
      return cb()
    }
    
    let countCall = 0
    const idInterval = setInterval(() => {
      
      if (chek()) {
        clearInterval(idInterval)
        return cb()
      }
      
      if (MAX_CALL_WAIT <= countCall) {
        LOG.warn(`could not find window.${target}`)
        clearInterval(idInterval)
      }
      countCall++
    }, 100)
  }
  
  getOpt(name, defaultValue) {
    let currentValue = this.allOptions[name];
    return currentValue === undefined ? defaultValue : currentValue;
  }
  
  processEventsQueue(eventnObject) {
    let events = eventnObject.eventsQ;
    events.forEach((eventArgs) => {
      LOG.debug('Processing event', eventArgs, null, 2);
      let methodName = eventArgs.shift();
      let method = this[methodName];
      if (typeof method === 'function') {
        method.apply(this, eventArgs)
      } else {
        LOG.warn(`Unknown event '${methodName}' / ${typeof method}`)
      }
    })
    eventnObject.eventsQ = [];
  }
  
  /**
   * Get a user id (anonymous id) through cookies
   */
  getAnonymousId() {
    let cookies = new CookiesAccessor();
    let idCookie = cookies.getItem(this.idCookieName);
    if (!idCookie) {
      let newId = this.generateId();
      LOG.debug('New user id', newId);
      cookies.setItem(this.idCookieName, newId, Infinity, this.cookieDomain, document.location.protocol !== "http:");
      return newId;
    } else {
      return idCookie;
    }
  }
  
  track(event_type, event_data) {
    let payload = {
      api_key: this.apiKey,
      src: 'eventn',
      event_type: event_type,
      eventn_ctx: this.geteventnCtx(),
      eventn_data: event_data
    }
    this.sendJson(payload);
  }
  
  id(userProperties, doNotSendEvent) {
    this.userProperties = { ...this.userProperties, ...userProperties }
    if (!doNotSendEvent) {
      this.track('user_identify', {});
    }
  }
  
  send3p(sourceType, object) {
    let payload = {
      api_key: this.apiKey,
      event_type: '3rdparty',
      src: sourceType,
      src_payload: object,
      eventn_ctx: this.geteventnCtx(),
      eventn_data: {}
    }
    this.sendJson(payload);
  }
  
  geteventnCtx() {
    let now = new Date();
    return {
      event_id: this.generateId(),
      user: {
        anonymous_id: this.anonymousId,
        ...this.userProperties
      },
      user_agent: navigator.userAgent,
      utc_time: now.toISOString(),
      local_tz_offset: now.getTimezoneOffset(),
      referer: document.referrer,
      url: window.location.href,
      page_title: document.title,
      ...this.getDataFromParams()
    };
  }
  
  sendJson(json) {
    let req = new XMLHttpRequest();
    req.onerror = function () {
      LOG.warn('Failed to send', json)
    };
    let url = this.trackingHost + "/api/v1/event";
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      url = document.location.protocol + "//" + url;
    }
    url += "?token=" + this.apiKey;
    
    req.open('POST', url);
    req.setRequestHeader("Content-Type", "application/json");
    req.send(JSON.stringify(json))
  }
  
  initGAIntegration = () => {
    let gaHook = this.getOpt('ga_hook', false)
    if (window.ga && gaHook) {
      ga(tracker => {
        var originalSendHitTask = tracker?.get('sendHitTask');
        tracker?.set('sendHitTask', (model) => {
          var payLoad = model.get('hitPayload');
          if (eventnObject && eventnObject.dropLastGAEvent) {
            eventnObject.dropLastGAEvent = false;
          } else {
            originalSendHitTask(model);
          }
          let jsonPayload = this.parseQuery(payLoad);
          this.rename(jsonPayload, 'v', 'ga_protocol_version');
          this.rename(jsonPayload, 'tid', 'ga_property');
          this.rename(jsonPayload, 'ds', 'datasource');
          this.rename(jsonPayload, 'cid', 'client_id');
          this.rename(jsonPayload, 'uid', 'user_id');
          this.rename(jsonPayload, '_gid', 'ga_user_id', (id) => {return "GA1.1." + id});
          this.rename(jsonPayload, 'sc', 'session_control');
          this.rename(jsonPayload, 'uip', 'user_ip_override');
          this.rename(jsonPayload, 'ua', 'user_agent_override');
          this.rename(jsonPayload, 'dr', 'referrer');
          this.rename(jsonPayload, 'cn', 'campaign_name');
          this.rename(jsonPayload, 'cs', 'campaign_source');
          this.rename(jsonPayload, 'cm', 'campaign_medium');
          this.rename(jsonPayload, 'cc', 'campaign_context');
          this.rename(jsonPayload, 'sr', 'screen_size');
          this.rename(jsonPayload, 'vp', 'viewport_size');
          this.rename(jsonPayload, 'de', 'document_encoding');
          this.rename(jsonPayload, 'sd', 'screen_color');
          this.rename(jsonPayload, 'ul', 'user_language');
          this.rename(jsonPayload, 't', 'event_type');
          this.rename(jsonPayload, 'dl', 'url');
          this.rename(jsonPayload, 'dh', 'hostname');
          this.rename(jsonPayload, 'dp', 'path');
          this.rename(jsonPayload, 'dt', 'document_title');
          this.rename(jsonPayload, 'je', 'java_installed');
          this.rename(jsonPayload, 'jid');
          this.rename(jsonPayload, '_s');
          this.rename(jsonPayload, 'a');
          this.rename(jsonPayload, 'gdid');
          this.rename(jsonPayload, '_u');
          this.rename(jsonPayload, '_v');
          this.rename(jsonPayload, 'z');
          this.rename(jsonPayload, 'ti', 'transaction_id');
          this.rename(jsonPayload, 'tr', 'transaction_revenue');
          this.rename(jsonPayload, 'ts', 'transaction_shipping');
          this.rename(jsonPayload, 'tt', 'transaction_tax');
          this.rename(jsonPayload, 'in', 'item_name');
          this.rename(jsonPayload, 'ip', 'item_price');
          this.rename(jsonPayload, 'iq', 'item_quality');
          this.rename(jsonPayload, 'ic', 'item_code');
          this.rename(jsonPayload, 'iv', 'item_category');
          this.rename(jsonPayload, 'tcc', 'coupon_code');
          this.rename(jsonPayload, 'cos', 'checkout_step');
          
          this.rename(jsonPayload, 'ec', 'event_category');
          this.rename(jsonPayload, 'ea', 'event_action');
          this.rename(jsonPayload, 'el', 'event_label');
          this.rename(jsonPayload, 'ev', 'event_value');
          
          this.send3p('ga', jsonPayload);
        });
      });
      eventnObject.dropLastGAEvent = true
      try {
        ga('send', 'pageview');
      } finally {
        eventnObject.dropLastGAEvent = false;
      }
    }
  }
  
  rename(obj: Object, src: string, dst?: string, fn?: (value: any) => any) {
    if (obj[src] !== undefined) {
      if (dst) {
        obj[dst] = fn ? fn(obj[src]) : obj[src]
      }
      delete obj[src];
    }
  }
  
  initSegmentIntegration = () => {
    //Hook up to segment API
    
    let segmentHook = this.getOpt('segment_hook', false);
    if (window.analytics && segmentHook) {
      if (window.analytics.addSourceMiddleware) {
        window.analytics.addSourceMiddleware((chain) => {
          try {
            this.send3p('ajs', chain.payload);
          } catch (e) {
            LOG.warn('Failed to send an event', e)
          }
          
          if (eventnObject.dropLastSegmentEvent) {
            eventnObject.dropLastSegmentEvent = false;
          } else {
            chain.next(chain.payload);
          }
        });
        eventnObject.dropLastSegmentEvent = true;
        window.analytics.page();
      } else {
        LOG.warn("Invalid interceptor state. Analytics js initialized, but not completely");
      }
    } else if (segmentHook) {
      LOG.warn('Analytics.js listener is not set. Please, put eventn script after analytics.js initialization!');
    }
  }
  
  getCookieDomain() {
    return location.hostname.replace("www.", '');
  }
  
  generateId() {
    return Math.random().toString(36).substring(2, 12);
  }
  
  getDataFromParams() {
    let params = this.parseQuery();
    let result = {
      utm: {},
      click_id: {}
    }
    for (let name in params) {
      if (!params.hasOwnProperty(name)) {
        continue;
      }
      let val = params[name];
      if (name.startsWith(UTM_PREFIX)) {
        let utm = name.substring(UTM_PREFIX.length)
        if (UTM_TYPES.indexOf(utm) >= 0) {
          result.utm[utm] = val;
        }
      } else if (CLICK_IDS.indexOf(name)) {
        result.click_id[name] = params;
      }
    }
    return result
  }
  
  parseQuery(qs?: string): Record<string, string> {
    let queryString = qs || window.location.search.substring(1)
    let query = {};
    let pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
    for (let i = 0; i < pairs.length; i++) {
      let pair = pairs[i].split('=');
      query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    }
    return query;
  }
}

const eventnTracker = new EventnTracker();

//==================
// EXPORTS SETUP
//==================


for (const apiMethod of ['track', 'id', 'init']) {
  eventnObject[apiMethod] = function (...args) {
    let copy = args.slice();
    copy.unshift(apiMethod);
    eventnObject.eventsQ.push(copy as IEvents);
    eventnTracker.processEventsQueue(eventnObject);
  }
}
eventnTracker.processEventsQueue(eventnObject);
eventnObject.initialized = true;

export default eventnObject
// @ts-ignore
module.exports = eventnObject
