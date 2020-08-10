import {
  getCookieDomain,
  getCookie,
  setCookie,
  generateId,
  parseQuery,
  getDataFromParams,
  getHostWithProtocol
} from './helpers'

import {TrackerOptions, TrackerPlugin, IEventnTracker, ILogger} from './types'

export class EventnTracker implements IEventnTracker {
  private cookieDomain: string;
  private trackingHost: string;
  private idCookieName: string;
  private anonymousId: string;
  private userProperties = {};
  private apiKey: string;
  public logger: ILogger;

  constructor(options: TrackerOptions, plugins: TrackerPlugin[] = []) {
    this.cookieDomain = options['cookie_domain'] || getCookieDomain();
    this.trackingHost = getHostWithProtocol(options['tracking_host'] || 'track.ksense.io');
    this.idCookieName = options['cookie_name'] || '__eventn_id';
    this.anonymousId = this.getAnonymousId();
    this.userProperties = {}
    this.apiKey = options['key'] || 'NONE';
    this.logger = options.logger || { debug: () => {}, error: () => {}, warn: () => {}, info: () => {} } ;
    for (let i = 0; i < plugins.length; i += 1) {
      plugins[i](this);
    }
  }

  public track(event_type: string, event_data: any) {
    let payload = {
      api_key: this.apiKey,
      src: 'eventn',
      event_type: event_type,
      eventn_ctx: this.getEventnCtx(),
      eventn_data: event_data
    }
    this.sendJson(payload);
  }

  public id(userProperties: Record<string, any>, doNotSendEvent: boolean) {
    this.userProperties = {...this.userProperties, ...userProperties}
    if (!doNotSendEvent) {
      this.track('user_identify', {});
    }
  }

  public send3p (sourceType: string, object: any) {
    let payload = {
      api_key: this.apiKey,
      event_type: '3rdparty',
      src: sourceType,
      src_payload: object,
      eventn_ctx: this.getEventnCtx(),
      eventn_data: {}
    }
    this.sendJson(payload);
  }

  private getAnonymousId() {
    const idCookie = getCookie(this.idCookieName);
    if (idCookie) {
      return idCookie;
    }
    let newId = generateId();
    this.logger.debug('New user id', newId);
    setCookie(this.idCookieName, newId, Infinity, this.cookieDomain, document.location.protocol !== "http:");
    return newId;
  }

  private getEventnCtx() {
    let now = new Date();
    return {
      event_id: generateId(),
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
      ...getDataFromParams(parseQuery())
    };
  }

  private sendJson(json: object) {
    let req = new XMLHttpRequest();
    req.onerror = () => {
      logger: this.logger.warn('Failed to send', json);
    };
    const url = `${this.trackingHost}/api/v1/event?token=${this.apiKey}`;
    req.open('POST', url);
    req.setRequestHeader("Content-Type", "application/json");
    req.send(JSON.stringify(json))
  }
}
