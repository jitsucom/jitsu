import {
  generateId,
  getCookie,
  getCookieDomain,
  getDataFromParams,
  getHostWithProtocol,
  parseQuery,
  reformatDate,
  setCookie,
} from './helpers'

import {Event, EventCtx, EventnEvent, Logger, Tracker, TrackerOptions, TrackerPlugin} from './types'

export const initTracker = (opts?: TrackerOptions, plugins: TrackerPlugin[] = []): Tracker => {
  let cookieDomain: string;
  let trackingHost: string;
  let idCookieName: string;
  const loggerKeys = ['debug', 'info', 'warn', 'error'];
  let logger: Logger = loggerKeys.reduce((res, k) => ({
    ...res, [k]: () => {
    }
  }), {}) as Logger;
  logger: {
    logger = loggerKeys.reduce(
        (res, k) => ({...res, [k]: (...args: any[]) => (console as any)[k]('[eventNative]', ...args)}),
        {},
    ) as Logger;
  }
  let apiKey: string;
  let initialized = false;

  const getAnonymousId = () => {
    const idCookie = getCookie(idCookieName);
    if (idCookie) {
      logger: logger.debug('Existing user id', idCookie);
      return idCookie;
    }
    let newId = generateId();
    logger.debug('New user id', newId);
    setCookie(idCookieName, newId, Infinity, cookieDomain, document.location.protocol !== "http:");
    return newId;
  }
  let anonymousId: string;
  let userProperties = {}

  const makeEvent = (event_type: string, src: string): Event => ({
    api_key: apiKey,
    src,
    event_type,
    eventn_ctx: getCtx(),
  });

  const track = (type: string, data: any) => {
    logger: logger.debug('track event of type', type, data)
    const e = makeEvent(type, 'eventn');
    (e as EventnEvent).eventn_data = data;
    sendJson(e);
  }

  const id = (props: Record<string, any>, doNotSendEvent: boolean) => {
    userProperties = {...userProperties, ...props}
    logger: logger.debug('user identified:', props)
    if (!doNotSendEvent) {
      track('user_identify', {});
    }
  }

  const send3p = (sourceType: string, object: any, subType?: string) => {
    let eventType = '3rdparty'
    if (subType && subType !== ''){
      eventType += '_' + subType
    }

    const e = makeEvent(eventType, sourceType) as any;
    e.src_payload = object;
    sendJson(e);
  }

  const interceptAnalytics = (t: Tracker, analytics: any) => {
    if (!analytics || typeof analytics.addSourceMiddleware !== 'function') {
      logger: t.logger.error('analytics.addSourceMiddleware is not a function', analytics)
      return;
    }

    let interceptor = (chain: any) => {
          try {
            let payload = {...chain.payload}

            let integration = chain.integrations['Segment.io']
            if (integration && integration.analytics) {
              let analyticsOriginal = integration.analytics
              if (typeof analyticsOriginal.user === 'function' && analyticsOriginal.user() && typeof analyticsOriginal.user().id === 'function') {
                payload.obj.userId = analyticsOriginal.user().id()
              }
            }

            let subType = chain.payload.type();
            if (subType === 'track'){
              subType = chain.payload.event()
            }

            t.send3p('ajs', payload, subType);
          } catch
              (e) {
            logger: t.logger.warn('Failed to send an event', e)
          }

          chain.next(chain.payload);
        };

    analytics.addSourceMiddleware(interceptor);
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
      utc_time: reformatDate(now.toISOString()),
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
      req.onerror = (e) => {
        logger.error('Failed to send', json, e);
      };
      req.onload = () => {
        if (req.status !== 200) {
          logger.error('Failed to send data:', json, req.statusText, req.responseText)
        }
      }
    }
    const url = `${trackingHost}/api/v1/event?token=${apiKey}`;
    req.open('POST', url);
    req.setRequestHeader("Content-Type", "application/json");
    req.send(JSON.stringify(json))
    logger: logger.debug('sending json', json);
  }
  const eventN: Tracker = {
    track,
    send3p,
    id,
    interceptAnalytics,
    logger
  };
  const init = (options: TrackerOptions, plugins: TrackerPlugin[] = []) => {
    logger: logger.debug('initializing', options, plugins, '1.0.11')
    cookieDomain = options['cookie_domain'] || getCookieDomain();
    trackingHost = getHostWithProtocol(options['tracking_host'] || 'track.ksense.io');
    idCookieName = options['cookie_name'] || '__eventn_id';
    apiKey = options['key'] || 'NONE';
    logger = options.logger || logger;
    eventN.logger = logger;
    anonymousId = getAnonymousId();
    for (let i = 0; i < plugins.length; i += 1) {
      plugins[i](eventN);
    }
    initialized = true;
  }
  if (opts) {
    init(opts)
  } else {
    eventN.init = init;
  }
  for (let i = 0; i < plugins.length; i += 1) {
    plugins[i](eventN);
  }
  return eventN;
}
