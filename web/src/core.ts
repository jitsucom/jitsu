import {awaitGlobalProp, generateId, generateRandom, getCookie, getCookieDomain, getCookies, getDataFromParams, getHostWithProtocol, parseQuery, reformatDate, setCookie,} from './helpers'
import {Event, EventCtx, EventPayload, Tracker, TrackerOptions, UserProps} from './types'
import {interceptGoogleAnalytics} from "./ga-interceptor";
import {getLogger, LogLevel, LogLevels, Logger} from "./logger";


const VERSION_INFO = {
    env: '__buildEnv__',
    date: '__buildDate__',
    version: '__buildVersion__'
}

const EVENTN_VERSION = `${VERSION_INFO.version}/${VERSION_INFO.env}@${VERSION_INFO.date}`;




class UserIdPersistance {
    private cookieDomain: string;
    private cookieName: string;


    constructor(cookieDomain: string, cookieName: string) {
        this.cookieDomain = cookieDomain;
        this.cookieName = cookieName;
    }

    public save(props: Record<string, any>) {
        setCookie(this.cookieName, encodeURIComponent(JSON.stringify(props)), Infinity, this.cookieDomain, document.location.protocol !== "http:");
    }

    restore(): Record<string, any> | undefined {
        let str = getCookie(this.cookieName);
        if (str) {
            try {
                return JSON.parse(decodeURIComponent(str));
            } catch (e) {
                console.error("Failed to decode JSON from " + str, e);
                return undefined;
            }
        }
        return undefined;
    }
}


class TrackerImpl implements Tracker {
    logger: Logger = getLogger();
    private userIdPersistance?: UserIdPersistance;

    private anonymousId: string = "";
    private userProperties: UserProps = {}
    private cookieDomain: string = "";
    private trackingHost: string = "";
    private idCookieName: string = "";
    private randomizeUrl: boolean = false;

    private apiKey: string = "";
    private initialized: boolean = false;
    private _3pCookies: Record<string, boolean> = {};
    private initialOptions?: TrackerOptions;

    id(props: UserProps, doNotSendEvent?: boolean): Promise<void> {
        this.userProperties = {...this.userProperties, ...props}
        this.logger.debug('user identified:', props)
        if (this.userIdPersistance) {
            this.userIdPersistance.save(props);
        } else {
            this.logger.warn("Id() is called before initialization")
        }
        if (!doNotSendEvent) {
            return this.track('user_identify', {});
        } else {
            return Promise.resolve();
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

    makeEvent(event_type: string, src: string, payload: EventPayload): Event {
        this.restoreId();
        return {
            api_key: this.apiKey,
            src,
            event_type,
            eventn_ctx: this.getCtx(),
            ...payload
        };
    }

    _send3p(sourceType: string, object: any, type?: string): Promise<any> {
        let eventType = '3rdparty'
        if (type && type !== '') {
            eventType = type
        }

        const e = this.makeEvent(eventType, sourceType, {
            src_payload: object
        });
        return this.sendJson(e);
    }

    sendJson(json: Event): Promise<void> {
        let url = `${this.trackingHost}/api/v1/event?token=${this.apiKey}`;
        if (this.randomizeUrl) {
            url = `${this.trackingHost}/api.${generateRandom()}?p_${generateRandom()}=${this.apiKey}`;
        }

        let jsonString = JSON.stringify(json);
        if (this.initialOptions?.use_beacon_api && navigator.sendBeacon) {
            this.logger.debug("Sending beacon", json);
            const blob = new Blob([jsonString], {type: 'text/plain'});
            navigator.sendBeacon(url, blob);
            return Promise.resolve();
        } else {
            let req = new XMLHttpRequest();
            return new Promise((resolve, reject) => {
                req.onerror = (e) => {
                    this.logger.error('Failed to send', json, e);
                    reject(new Error(`Failed to send JSON. See console logs`))
                };
                req.onload = () => {
                    if (req.status !== 200) {
                        this.logger.error('Failed to send data:', json, req.statusText, req.responseText)
                        reject(new Error(`Failed to send JSON. Error code: ${req.status}. See logs for details`))
                    }
                    resolve();
                }
                req.open('POST', url);
                req.setRequestHeader("Content-Type", "application/json");
                req.send(jsonString)
                this.logger.debug('sending json', json);
            });
        }
    }

    getCtx(): EventCtx {
        let now = new Date();
        return {
            event_id: "", //generate id on the backend side
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

    track(type: string, payload?: EventPayload): Promise<void> {
        let data = payload || {};
        this.logger.debug('track event of type', type, data)
        const e = this.makeEvent(type, 'eventn', payload || {});
        return this.sendJson(e);
    }

    init(options?: TrackerOptions) {
        if (!options) {
            options = {}
        }
        this.initialOptions = options;
        this.logger = getLogger(options.log_level ? LogLevels[options.log_level] : undefined)
        this.logger.debug('Initializing eventN tracker', options, EVENTN_VERSION)
        this.cookieDomain = options['cookie_domain'] || getCookieDomain();
        this.trackingHost = getHostWithProtocol(options['tracking_host'] || 't.jitsu.com');
        this.randomizeUrl = options['randomize_url'] || false;
        this.idCookieName = options['cookie_name'] || '__eventn_id';
        this.apiKey = options['key'] || 'NONE';
        this.userIdPersistance = new UserIdPersistance(this.cookieDomain, this.idCookieName + "_usr");
        if (options.capture_3rd_party_cookies === false) {
            this._3pCookies = {}
        } else {
            (options.capture_3rd_party_cookies || ['_ga', '_fbp', '_ym_uid', 'ajs_user_id', 'ajs_anonymous_id'])
                .forEach(name => this._3pCookies[name] = true)
        }

        if (options.ga_hook) {
            interceptGoogleAnalytics(this);
        }
        if (options.segment_hook) {
            interceptSegmentCalls(this);
        }
        this.anonymousId = this.getAnonymousId();
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

    private restoreId() {
        if (this.userIdPersistance) {
            let props = this.userIdPersistance.restore();
            if (props) {
                this.userProperties = {...props, ...this.userProperties};
            }
        }
    }
}

function interceptSegmentCalls(t: Tracker, globalPropName: string = 'analytics') {
    awaitGlobalProp(globalPropName).then(
        (analytics: any) => {
            if (!analytics['__en_intercepted']) {
                t.interceptAnalytics(analytics)
            }
        }
    ).catch(e => {
        t.logger.error("Can't get segment object", e);
    })
}


export const initTracker = (opts?: TrackerOptions): Tracker => {
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
    return eventN;
}
