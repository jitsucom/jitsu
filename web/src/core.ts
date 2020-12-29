import {
    generateId, generateRandom, generateUuidV4,
    getCookie,
    getCookieDomain, getCookies,
    getDataFromParams,
    getHostWithProtocol,
    parseQuery,
    reformatDate,
    setCookie,
} from './helpers'
import {Event, Logger, EventCtx, Tracker, TrackerOptions, TrackerPlugin, EventPayload, UserProps} from './types'


const VERSION_INFO = {
    env: '__buildEnv__',
    date: '__buildDate__',
    version: '__buildVersion__'
}

const EVENTN_VERSION = `${VERSION_INFO.version}/${VERSION_INFO.env}@${VERSION_INFO.date}`;


function initLogger(): Logger {
    const loggerKeys = ['debug', 'info', 'warn', 'error'];
    let logger: Logger = loggerKeys.reduce((res, k) => ({
        ...res, [k]: () => {
        }
    }), {}) as Logger;
    return logger;
}

function putId(props: UserProps): UserProps {
    if (props.id) {
        return props;
    }
    for (let [key, value] of Object.entries(props)) {
        if (key !== "id" && key !== "anonymous_id") {
            props.id = value;
            return props;
        }
    }
    return props;
}


class TrackerImpl implements Tracker {
    logger: Logger = initLogger();

    private anonymousId: string = "";
    private userProperties: any = {}
    private cookieDomain: string = "";
    private trackingHost: string = "";
    private idCookieName: string = "";
    private randomizeUrl: boolean = false;

    private apiKey: string = "";
    private initialized: boolean = false;
    private _3pCookies: Record<string, boolean> = {};

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
        let newId = generateUuidV4();
        this.logger.debug('New user id', newId);
        setCookie(this.idCookieName, newId, Infinity, this.cookieDomain, document.location.protocol !== "http:");
        return newId;
    }

    makeEvent(event_type: string, src: string, payload: EventPayload): Event {
        return {
            api_key: this.apiKey,
            src,
            event_type,
            eventn_ctx: this.getCtx(),
            ...payload
        };
    }

    _send3p(sourceType: string, object: any, type?: string) {
        let eventType = '3rdparty'
        if (type && type !== '') {
            eventType = type
        }

        const e = this.makeEvent(eventType, sourceType, {
            src_payload: object
        });
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
        let url = `${this.trackingHost}/api/v1/event?token=${this.apiKey}`;
        if (this.randomizeUrl) {
            url = `${this.trackingHost}/api.${generateRandom()}?p_${generateRandom()}=${this.apiKey}`;
        }
        req.open('POST', url);
        req.setRequestHeader("Content-Type", "application/json");
        req.send(JSON.stringify(json))
        this.logger.debug('sending json', json);
    }

    getCtx(): EventCtx {
        let now = new Date();
        return {
            event_id: generateUuidV4(),
            user: putId({
                anonymous_id: this.anonymousId,
                ...this.userProperties
            }),
            ids: this._getIds(),
            user_agent: navigator.userAgent,
            utc_time: reformatDate(now.toISOString()),
            local_tz_offset: now.getTimezoneOffset(),
            referer: document.referrer,
            url: window.location.href,
            page_title: document.title,
            doc_path: document.location.pathname,
            doc_host: document.location.hostname,
            screen_resolution: screen.width + "x" + screen.height,
            vp_size: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0) + "x" + Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
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
                res[key.charAt(0) == '_' ? key.substr(1) : key] = value;
            }
        }
        return res;
    }

    track(type: string, payload?: EventPayload) {
        let data = payload || {};
        this.logger.debug('track event of type', type, data)
        const e = this.makeEvent(type, 'eventn', payload || {});
        this.sendJson(e);
    }

    init(options: TrackerOptions, plugins: TrackerPlugin[] = []) {
        this.logger.debug('Initializing', options, plugins, EVENTN_VERSION)
        this.cookieDomain = options['cookie_domain'] || getCookieDomain();
        this.trackingHost = getHostWithProtocol(options['tracking_host'] || 't.jitsu.com');
        this.randomizeUrl = options['randomize_url'] || false;
        this.idCookieName = options['cookie_name'] || '__eventn_id';
        this.apiKey = options['key'] || 'NONE';
        this.logger = initLogger();
        if (options.capture_3rd_party_cookies === false) {
            this._3pCookies = {}
        } else  {
            (options.capture_3rd_party_cookies || ['_ga', '_fbp', '_ym_uid', 'ajs_user_id', 'ajs_anonymous_id'])
                .forEach(name => this._3pCookies[name] = true)
        }
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

                this._send3p('ajs', payload, type);
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
    if (window) {
        (window as any)["__eventNDebug"] = {
            clientVersion: EVENTN_VERSION
        }
    }

    const eventN = new TrackerImpl();
    if (window) {
        (window as any)["__eventNDebug"]['instance'] = eventN;
    }
    if (opts) {
        eventN.init(opts)
    }
    for (let i = 0; i < plugins.length; i += 1) {
        plugins[i](eventN);
    }
    return eventN;
}
