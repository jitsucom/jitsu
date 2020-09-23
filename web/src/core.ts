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

import {Event, Logger, EventCtx, EventnEvent, Tracker, TrackerOptions, TrackerPlugin} from './types'


function initLogger(): Logger {
    const loggerKeys = ['debug', 'info', 'warn', 'error'];
    let logger: Logger = loggerKeys.reduce((res, k) => ({
        ...res, [k]: () => {
        }
    }), {}) as Logger;
    return logger;
}

class TrackerImpl implements Tracker {
    logger: Logger = initLogger();

    private anonymousId: string = "";
    private userProperties: any = {}
    private cookieDomain: string = "";
    private trackingHost: string = "";
    private idCookieName: string = "";

    private apiKey: string = "";
    private initialized: boolean = false;

    id(props: Record<string, any>, doNotSendEvent?: boolean): void {
        this.userProperties = {...this.userProperties, ...props}
        this.logger.debug('user identified:', props)
        if (!doNotSendEvent) {
            this.track('user_identify', {});
        }
    }

    getAnonymousId() {
        const idCookie = getCookie(this.idCookieName);
        if (idCookie) {
            this.logger.debug('Existing user id', idCookie);
            return idCookie;
        }
        let newId = generateId();
        this.logger.debug('New user id', newId);
        setCookie(this.idCookieName, newId, Infinity, this.cookieDomain, document.location.protocol !== "http:");
        return newId;
    }

    makeEvent(event_type: string, src: string): Event {
        return {
            api_key: this.apiKey,
            src,
            event_type,
            eventn_ctx: this.getCtx(),
        };
    }

    send3p(sourceType: string, object: any, type?: string) {
        let eventType = '3rdparty'
        if (type && type !== '') {
            eventType = type
        }

        const e = this.makeEvent(eventType, sourceType) as any;
        e.src_payload = object;
        this.sendJson(e);
    }

    sendJson(json: Event) {
        let req = new XMLHttpRequest();
        logger: {
            req.onerror = (e) => {
                this.logger.error('Failed to send', json, e);
            };
            req.onload = () => {
                if (req.status !== 200) {
                    this.logger.error('Failed to send data:', json, req.statusText, req.responseText)
                }
            }
        }
        const url = `${this.trackingHost}/api/v1/event?token=${this.apiKey}`;
        req.open('POST', url);
        req.setRequestHeader("Content-Type", "application/json");
        req.send(JSON.stringify(json))
        this.logger.debug('sending json', json);
    }

    getCtx(): EventCtx {
        let now = new Date();
        return {
            event_id: generateId(),
            user: {
                anonymous_id: this.anonymousId,
                ...this.userProperties
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

    track(type: string, data: any) {
        this.logger.debug('track event of type', type, data)
        const e = this.makeEvent(type, 'eventn');
        (e as EventnEvent).eventn_data = data;
        this.sendJson(e);
    }

    init(options: TrackerOptions, plugins: TrackerPlugin[] = []) {
        this.logger.debug('initializing', options, plugins, '1.0.11')
        this.cookieDomain = options['cookie_domain'] || getCookieDomain();
        this.trackingHost = getHostWithProtocol(options['tracking_host'] || 'track.ksense.io');
        this.idCookieName = options['cookie_name'] || '__eventn_id';
        this.apiKey = options['key'] || 'NONE';
        this.logger = initLogger();
        this.anonymousId = this.getAnonymousId();
        for (let i = 0; i < plugins.length; i += 1) {
            plugins[i](this);
        }
        this.initialized = true;
    }

    interceptAnalytics(analytics: any) {
        if (!analytics || typeof analytics.addSourceMiddleware !== 'function') {
            this.logger.error('analytics.addSourceMiddleware is not a function', analytics)
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

                let type = chain.payload.type();
                if (type === 'track') {
                    type = chain.payload.event()
                }

                this.send3p('ajs', payload, type);
            } catch (e) {
                this.logger.warn('Failed to send an event', e)
            }

            chain.next(chain.payload);
        };
        analytics.addSourceMiddleware(interceptor);
        analytics['__en_intercepted'] = true
    }
}

export const initTracker = (opts?: TrackerOptions, plugins: TrackerPlugin[] = []): Tracker => {

    const eventN = new TrackerImpl();
    if (opts) {
        eventN.init(opts)
    }
    for (let i = 0; i < plugins.length; i += 1) {
        plugins[i](eventN);
    }
    return eventN;
}
