import {
  getCookieDomain,
  getCookie,
  setCookie,
  generateId,
  parseQuery,
  getDataFromParams,
  getHostWithProtocol
} from './helpers'

import {
  TrackerOptions,
  TrackerPlugin,
  Tracker,
  Logger,
  Event,
  EventCtx, ThirdPartyEvent, EventnEvent
} from './types'

export const initTracker = (opts?: TrackerOptions, plugins: TrackerPlugin[] = []): Tracker => {
  let cookieDomain: string;
  let trackingHost: string;
  let idCookieName: string;
  let logger: Logger = { debug: () => {}, error: () => {}, warn: () => {}, info: () => {} } ;
  let apiKey: string;
  let initialized = false;

  const getAnonymousId = () => {
    const idCookie = getCookie(idCookieName);
    if (idCookie) {
      return idCookie;
    }
    let newId = generateId();
    logger.debug('New user id', newId);
    setCookie(idCookieName, newId, Infinity, cookieDomain, document.location.protocol !== "http:");
    return newId;
  }
  const anonymousId = getAnonymousId();
  let userProperties = {}

  const makeEvent = (event_type: string, src: string): Event => ({
    api_key: apiKey,
    src,
    event_type,
    eventn_ctx: getCtx(),
  });

  const track = (type: string, data: any) => {
    const e = makeEvent(type, 'eventn');
    (e as EventnEvent).eventn_data = data;
    sendJson(e);
  }

  const id = (props: Record<string, any>, doNotSendEvent: boolean) => {
    userProperties = {...userProperties, ...props}
    if (!doNotSendEvent) {
      track('user_identify', {});
    }
  }

  const send3p = (sourceType: string, object: any) => {
    const e = makeEvent('3rdparty', sourceType) as any;
    e.src_payload = object;
    sendJson(e);
  }


  const getCtx = (): EventCtx => {
    let now = new Date();
    return {
      event_id: generateId(),
      user: {
        anonymous_id: anonymousId,
        ...userProperties
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

  const sendJson = (json: Event) => {
    let req = new XMLHttpRequest();
    logger: {
      req.onerror = () => {
        logger.warn('Failed to send', json);
      };
    }
    const url = `${trackingHost}/api/v1/event?token=${apiKey}`;
    req.open('POST', url);
    req.setRequestHeader("Content-Type", "application/json");
    req.send(JSON.stringify(json))
  }
  const eventN: Tracker = {
    track,
    send3p,
    id,
    logger
  };
  const init = (options: TrackerOptions, plugins: TrackerPlugin[] = []) => {
    cookieDomain = options['cookie_domain'] || getCookieDomain();
    trackingHost = getHostWithProtocol(options['tracking_host'] || 'track.ksense.io');
    idCookieName = options['cookie_name'] || '__eventn_id';
    apiKey = options['key'] || 'NONE';
    if (options.logger) {
      logger = options.logger;
      eventN.logger = logger;
    }
    for (let i = 0; i < plugins.length; i += 1) {
      plugins[i](eventN);
    }
    initialized = true;
  }
  if (opts) {
    init(opts, plugins)
  } else {
    eventN.init = init;
  }
  return eventN;
}
