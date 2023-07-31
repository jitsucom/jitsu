"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var __assign = function() {
    __assign = Object.assign || function __assign(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};

function __spreadArrays() {
    for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
    for (var r = Array(s), k = 0, i = 0; i < il; i++) for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, 
    k++) r[k] = a[j];
    return r;
}

var getCookieDomain = function() {
    return location.hostname.replace("www.", "");
};

var cookieParsingCache;

var getCookies = function(useCache) {
    if (void 0 === useCache) useCache = false;
    if (useCache && cookieParsingCache) return cookieParsingCache;
    var res = {};
    var cookies = document.cookie.split(";");
    for (var i = 0; i < cookies.length; i++) {
        var cookie = cookies[i];
        var idx = cookie.indexOf("=");
        if (idx > 0) res[cookie.substr(i > 0 ? 1 : 0, i > 0 ? idx - 1 : idx)] = cookie.substr(idx + 1);
    }
    cookieParsingCache = res;
    return res;
};

var getCookie = function(name) {
    if (!name) return null;
    return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(name).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1")) || null;
};

var setCookie = function(name, value, expire, domain, secure) {
    var expireString = expire === 1 / 0 ? " expires=Fri, 31 Dec 9999 23:59:59 GMT" : "; max-age=" + expire;
    document.cookie = encodeURIComponent(name) + "=" + value + "; path=/;" + expireString + (domain ? "; domain=" + domain : "") + (secure ? "; secure" : "");
};

var generateId = function() {
    return Math.random().toString(36).substring(2, 12);
};

var generateRandom = function() {
    return Math.random().toString(36).substring(2, 7);
};

var parseQuery = function(qs) {
    var queryString = qs || window.location.search.substring(1);
    var query = {};
    var pairs = ("?" === queryString[0] ? queryString.substr(1) : queryString).split("&");
    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split("=");
        query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
    }
    return query;
};

var UTM_TYPES = {
    utm_source: "source",
    utm_medium: "medium",
    utm_campaign: "campaign",
    utm_term: "term",
    utm_content: "content"
};

var CLICK_IDS = {
    gclid: true,
    fbclid: true,
    dclid: true
};

var getDataFromParams = function(params) {
    var result = {
        utm: {},
        click_id: {}
    };
    for (var name in params) {
        if (!params.hasOwnProperty(name)) continue;
        var val = params[name];
        var utm = UTM_TYPES[name];
        if (utm) result.utm[utm] = val; else if (CLICK_IDS[name]) result.click_id[name] = val;
    }
    return result;
};

var reformatDate = function(strDate) {
    var end = strDate.split(".")[1];
    if (!end) return strDate;
    if (end.length >= 7) return strDate;
    return strDate.slice(0, -1) + "0".repeat(7 - end.length) + "Z";
};

function endsWith(str, suffix) {
    return -1 !== str.indexOf(suffix, str.length - suffix.length);
}

var getHostWithProtocol = function(host) {
    while (endsWith(host, "/")) host = host.substr(0, host.length - 1);
    if (0 === host.indexOf("https://") || 0 === host.indexOf("http://")) return host; else return "//" + host;
};

function awaitCondition(condition, factory, timeout, retries) {
    if (void 0 === timeout) timeout = 500;
    if (void 0 === retries) retries = 4;
    return new Promise((function(resolve, reject) {
        if (condition()) {
            resolve(factory());
            return;
        }
        if (0 === retries) {
            reject("condition rejected");
            return;
        }
        setTimeout((function() {
            awaitCondition(condition, factory, timeout, retries - 1).then(resolve).catch(reject);
        }), timeout);
    }));
}

function awaitGlobalProp(prop, timeout, retries) {
    if (void 0 === timeout) timeout = 500;
    if (void 0 === retries) retries = 4;
    return awaitCondition((function() {
        return void 0 !== window[prop];
    }), (function() {
        return window[prop];
    }), timeout, retries);
}

var dropLastGAEvent = false;

function interceptGoogleAnalytics(t, globalPropName) {
    if (void 0 === globalPropName) globalPropName = "ga";
    awaitGlobalProp(globalPropName).then((function(ga) {
        ga((function(tracker) {
            var originalSendHitTask = tracker.get("sendHitTask");
            tracker.set("sendHitTask", (function(model) {
                var payLoad = model.get("hitPayload");
                if (dropLastGAEvent) dropLastGAEvent = false; else originalSendHitTask(model);
                t._send3p("ga", mapGaPayload(parseQuery(payLoad)));
            }));
        }));
        dropLastGAEvent = true;
        try {
            ga("send", "pageview");
        } finally {
            dropLastGAEvent = false;
        }
    })).catch((function(e) {
        t.logger.error(e);
    }));
}

var propsMap = {
    cc: "campaign_context",
    cid: "client_id",
    cm: "campaign_medium",
    cn: "campaign_name",
    cos: "checkout_step",
    cs: "campaign_source",
    de: "document_encoding",
    dh: "hostname",
    dl: "url",
    dp: "path",
    dr: "referrer",
    ds: "datasource",
    dt: "document_title",
    ea: "event_action",
    ec: "event_category",
    el: "event_label",
    ev: "event_value",
    ic: "item_code",
    in: "item_name",
    ip: "item_price",
    iq: "item_quality",
    iv: "item_category",
    je: "java_installed",
    sc: "session_control",
    sd: "screen_color",
    sr: "screen_size",
    t: "event_type",
    tcc: "coupon_code",
    ti: "transaction_id",
    tid: "ga_property",
    tr: "transaction_revenue",
    ts: "transaction_shipping",
    tt: "transaction_tax",
    ua: "user_agent_override",
    uid: "user_id",
    uip: "user_ip_override",
    ul: "user_language",
    v: "ga_protocol_version",
    vp: "viewport_size",
    _gid: "ga_user_id"
};

var mapGaPayload = function(data) {
    return Object.entries(data).reduce((function(res, _a) {
        var k = _a[0], v = _a[1];
        var tp = propsMap[k];
        if (void 0 !== tp) res[tp] = v;
        return res;
    }), {});
};

var LogLevels = {
    DEBUG: {
        name: "DEBUG",
        severity: 10
    },
    INFO: {
        name: "INFO",
        severity: 100
    },
    WARN: {
        name: "WARN",
        severity: 1e3
    },
    ERROR: {
        name: "ERRO",
        severity: 1e4
    }
};

function getLogger(logLevel) {
    var globalLogLevel = window["__eventNLogLevel"];
    var minLogLevel = LogLevels.WARN;
    if (globalLogLevel) {
        var level = LogLevels[globalLogLevel.toUpperCase()];
        if (level && level > 0) minLogLevel = level;
    } else if (logLevel) minLogLevel = logLevel;
    var logger = {
        minLogLevel: minLogLevel
    };
    Object.values(LogLevels).forEach((function(_a) {
        var name = _a.name, severity = _a.severity;
        logger[name.toLowerCase()] = function() {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) args[_i] = arguments[_i];
            if (severity >= minLogLevel.severity && args.length > 0) {
                var message = args[0];
                var msgArgs = args.splice(1);
                if ("DEBUG" === name || "INFO" === name) console.log.apply(console, __spreadArrays([ message ], msgArgs)); else if ("WARN" === name) console.warn.apply(console, __spreadArrays([ message ], msgArgs)); else console.error.apply(console, __spreadArrays([ message ], msgArgs));
            }
        };
    }));
    window["__eventNLogger"] = logger;
    return logger;
}

var VERSION_INFO = {
    env: "production",
    date: "2021-12-07T11:41:17.948Z",
    version: "1.1.7"
};

var EVENTN_VERSION = VERSION_INFO.version + "/" + VERSION_INFO.env + "@" + VERSION_INFO.date;

var UserIdPersistance = function() {
    function UserIdPersistance(cookieDomain, cookieName) {
        this.cookieDomain = cookieDomain;
        this.cookieName = cookieName;
    }
    UserIdPersistance.prototype.save = function(props) {
        setCookie(this.cookieName, encodeURIComponent(JSON.stringify(props)), 1 / 0, this.cookieDomain, "http:" !== document.location.protocol);
    };
    UserIdPersistance.prototype.restore = function() {
        var str = getCookie(this.cookieName);
        if (str) try {
            return JSON.parse(decodeURIComponent(str));
        } catch (e) {
            console.error("Failed to decode JSON from " + str, e);
            return;
        }
        return;
    };
    return UserIdPersistance;
}();

var TrackerImpl = function() {
    function TrackerImpl() {
        this.logger = getLogger();
        this.anonymousId = "";
        this.userProperties = {};
        this.cookieDomain = "";
        this.trackingHost = "";
        this.idCookieName = "";
        this.randomizeUrl = false;
        this.apiKey = "";
        this.initialized = false;
        this._3pCookies = {};
    }
    TrackerImpl.prototype.id = function(props, doNotSendEvent) {
        this.userProperties = __assign(__assign({}, this.userProperties), props);
        this.logger.debug("user identified:", props);
        if (this.userIdPersistance) this.userIdPersistance.save(props); else this.logger.warn("Id() is called before initialization");
        if (!doNotSendEvent) return this.track("user_identify", {}); else return Promise.resolve();
    };
    TrackerImpl.prototype.getAnonymousId = function() {
        var idCookie = getCookie(this.idCookieName);
        if (idCookie) {
            this.logger.debug("Existing user id", idCookie);
            return idCookie;
        }
        var newId = generateId();
        this.logger.debug("New user id", newId);
        setCookie(this.idCookieName, newId, 1 / 0, this.cookieDomain, "http:" !== document.location.protocol);
        return newId;
    };
    TrackerImpl.prototype.makeEvent = function(event_type, src, payload) {
        this.restoreId();
        return __assign({
            api_key: this.apiKey,
            src: src,
            event_type: event_type,
            eventn_ctx: this.getCtx()
        }, payload);
    };
    TrackerImpl.prototype._send3p = function(sourceType, object, type) {
        var eventType = "3rdparty";
        if (type && "" !== type) eventType = type;
        var e = this.makeEvent(eventType, sourceType, {
            src_payload: object
        });
        return this.sendJson(e);
    };
    TrackerImpl.prototype.sendJson = function(json) {
        var _this = this;
        var _a;
        var url = this.trackingHost + "/api/v1/event?token=" + this.apiKey;
        if (this.randomizeUrl) url = this.trackingHost + "/api." + generateRandom() + "?p_" + generateRandom() + "=" + this.apiKey;
        var jsonString = JSON.stringify(json);
        if ((null === (_a = this.initialOptions) || void 0 === _a ? void 0 : _a.use_beacon_api) && navigator.sendBeacon) {
            this.logger.debug("Sending beacon", json);
            var blob = new Blob([ jsonString ], {
                type: "text/plain"
            });
            navigator.sendBeacon(url, blob);
            return Promise.resolve();
        } else {
            var req_1 = new XMLHttpRequest;
            return new Promise((function(resolve, reject) {
                req_1.onerror = function(e) {
                    _this.logger.error("Failed to send", json, e);
                    reject(new Error("Failed to send JSON. See console logs"));
                };
                req_1.onload = function() {
                    if (200 !== req_1.status) {
                        _this.logger.error("Failed to send data:", json, req_1.statusText, req_1.responseText);
                        reject(new Error("Failed to send JSON. Error code: " + req_1.status + ". See logs for details"));
                    }
                    resolve();
                };
                req_1.open("POST", url);
                req_1.setRequestHeader("Content-Type", "application/json");
                req_1.send(jsonString);
                _this.logger.debug("sending json", json);
            }));
        }
    };
    TrackerImpl.prototype.getCtx = function() {
        var now = new Date;
        return __assign({
            event_id: "",
            user: __assign({
                anonymous_id: this.anonymousId
            }, this.userProperties),
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
            doc_encoding: document.characterSet
        }, getDataFromParams(parseQuery()));
    };
    TrackerImpl.prototype._getIds = function() {
        var cookies = getCookies(false);
        var res = {};
        for (var _i = 0, _a = Object.entries(cookies); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], value = _b[1];
            if (this._3pCookies[key]) res["_" == key.charAt(0) ? key.substr(1) : key] = value;
        }
        return res;
    };
    TrackerImpl.prototype.track = function(type, payload) {
        var data = payload || {};
        this.logger.debug("track event of type", type, data);
        var e = this.makeEvent(type, "eventn", payload || {});
        return this.sendJson(e);
    };
    TrackerImpl.prototype.init = function(options) {
        var _this = this;
        if (!options) options = {};
        this.initialOptions = options;
        this.logger = getLogger(options.log_level ? LogLevels[options.log_level] : void 0);
        this.logger.debug("Initializing eventN tracker", options, EVENTN_VERSION);
        this.cookieDomain = options["cookie_domain"] || getCookieDomain();
        this.trackingHost = getHostWithProtocol(options["tracking_host"] || "t.jitsu.com");
        this.randomizeUrl = options["randomize_url"] || false;
        this.idCookieName = options["cookie_name"] || "__eventn_id";
        this.apiKey = options["key"] || "NONE";
        this.userIdPersistance = new UserIdPersistance(this.cookieDomain, this.idCookieName + "_usr");
        if (false === options.capture_3rd_party_cookies) this._3pCookies = {}; else (options.capture_3rd_party_cookies || [ "_ga", "_fbp", "_ym_uid", "ajs_user_id", "ajs_anonymous_id" ]).forEach((function(name) {
            return _this._3pCookies[name] = true;
        }));
        if (options.ga_hook) interceptGoogleAnalytics(this);
        if (options.segment_hook) interceptSegmentCalls(this);
        this.anonymousId = this.getAnonymousId();
        this.initialized = true;
    };
    TrackerImpl.prototype.interceptAnalytics = function(analytics) {
        var _this = this;
        if (!analytics || "function" !== typeof analytics.addSourceMiddleware) {
            this.logger.error("analytics.addSourceMiddleware is not a function", analytics);
            return;
        }
        var interceptor = function(chain) {
            try {
                var payload = __assign({}, chain.payload);
                var integration = chain.integrations["Segment.io"];
                if (integration && integration.analytics) {
                    var analyticsOriginal = integration.analytics;
                    if ("function" === typeof analyticsOriginal.user && analyticsOriginal.user() && "function" === typeof analyticsOriginal.user().id) payload.obj.userId = analyticsOriginal.user().id();
                }
                var type = chain.payload.type();
                if ("track" === type) type = chain.payload.event();
                _this._send3p("ajs", payload, type);
            } catch (e) {
                _this.logger.warn("Failed to send an event", e);
            }
            chain.next(chain.payload);
        };
        analytics.addSourceMiddleware(interceptor);
        analytics["__en_intercepted"] = true;
    };
    TrackerImpl.prototype.restoreId = function() {
        if (this.userIdPersistance) {
            var props = this.userIdPersistance.restore();
            if (props) this.userProperties = __assign(__assign({}, props), this.userProperties);
        }
    };
    return TrackerImpl;
}();

function interceptSegmentCalls(t, globalPropName) {
    if (void 0 === globalPropName) globalPropName = "analytics";
    awaitGlobalProp(globalPropName).then((function(analytics) {
        if (!analytics["__en_intercepted"]) t.interceptAnalytics(analytics);
    })).catch((function(e) {
        t.logger.error("Can't get segment object", e);
    }));
}

var initTracker = function(opts) {
    if (window) window["__eventNDebug"] = {
        clientVersion: EVENTN_VERSION
    };
    var eventN = new TrackerImpl;
    if (window) window["__eventNDebug"]["instance"] = eventN;
    if (opts) eventN.init(opts);
    return eventN;
};

var eventN = initTracker();

exports.default = eventN;

exports.eventN = eventN;
