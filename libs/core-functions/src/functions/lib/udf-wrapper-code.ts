import { DropRetryErrorName, RetryErrorName } from "@jitsu/functions-lib";

export const functionsLibCode = `const DropRetryErrorName = "Drop & RetryError";
const RetryErrorName = "RetryError";
const TableNameParameter = "JITSU_TABLE_NAME";
class RetryError extends Error {
    constructor(message, options) {
        super(message);
        this.name = options?.drop ? "${DropRetryErrorName}" : "${RetryErrorName}";
    }
}

const ACode = "A".charCodeAt(0);
const ZCode = "Z".charCodeAt(0);
const aCode = "a".charCodeAt(0);
const zCode = "z".charCodeAt(0);
const spaceCode = " ".charCodeAt(0);

function idToSnakeCaseFast(id) {
  let res = "";
  let concatIndex = 0;
  let i = 0;
  let needUnderscore = false;
  for (; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (c >= ACode && c <= ZCode) {
      res += id.substring(concatIndex, i) + (needUnderscore ? "_" : "") + id.charAt(i).toLowerCase();
      concatIndex = i + 1;
    } else if (c == spaceCode) {
      res += id.substring(concatIndex, i) + "_";
      concatIndex = i + 1;
    }
    // needUnderscore is used in case next char is a capital latin letter
    // we add underscore only between latin letters
    needUnderscore = (c >= aCode && c <= zCode) || (c >= ACode && c <= ZCode);
  }
  if (concatIndex == 0) {
    return id;
  } else if (concatIndex < i) {
    res += id.substring(concatIndex, i);
  }
  return res;
}

function toSnakeCase(param) {
  if (Array.isArray(param)) {
    return param.map(toSnakeCase);
  } else if (typeof param === "object" && param !== null) {
    const r = {};
    for (const [key, value] of Object.entries(param)) {
      r[idToSnakeCaseFast(key)] = toSnakeCase(value);
    }
    return r;
  } else {
    return param;
  }
}

function removeUndefined(param) {
  if (Array.isArray(param)) {
    return param.map(removeUndefined);
  } else if (typeof param === "object" && param !== null) {
    for (const [key, value] of Object.entries(param)) {
      switch (typeof value) {
        case "undefined":
          delete param[key];
          break;
        case "object":
          if (value !== null) {
            removeUndefined(value);
          }
          break;
      }
    }
  }
  return param;
}

function transferAsSnakeCase(target, source, omit) {
  if (typeof source !== "object") {
    return;
  }
  for (const [k, v] of Object.entries(source)) {
    if (!omit || !omit.includes(k)) {
      target[idToSnakeCaseFast(k)] = toSnakeCase(v);
    }
  }
}

function transferValueAsSnakeCase(target, property, source) {
  if (typeof source === "undefined") {
    return;
  }
  target[property] = toSnakeCase(source);
}

function transfer(target, source, omit) {
  if (typeof source !== "object") {
    return;
  }
  for (const [k, v] of Object.entries(source)) {
    if (!omit || !omit.includes(k)) {
      target[k] = v;
    }
  }
}

function transferValue(target, property, source) {
  if (typeof source === "undefined") {
    return;
  }
  target[property] = source;
}


function anonymizeIp(ip) {
  if (!ip) {
    return;
  }
  const parts = ip.split(".");
  if (parts.length === 4) {
    return \`\${parts[0]}.\${parts[1]}.\${parts[2]}.0\`;
  }
}

function toJitsuClassic(event, ctx) {
  let url = undefined;
  const analyticsContext = event.context || {};
  const urlStr = analyticsContext.page?.url || event.properties?.url;
  const click_id = {};
  transfer(click_id, analyticsContext.clientIds, ["ga4", "fbp", "fbc"]);
  let ids = {};
  if (Object.keys(analyticsContext.clientIds || {}).length > 0) {
    ids = removeUndefined({
      ga: analyticsContext.clientIds.ga4?.clientId,
      fbp: analyticsContext.clientIds.fbp,
      fbc: analyticsContext.clientIds.fbc,
    });
  }
  const geo = analyticsContext.geo || {};
  const ua = ctx?.ua || {};
  const user = removeUndefined({
    id: event.userId,
    anonymous_id: event.anonymousId,
    email: analyticsContext.traits?.email || event.traits?.email || undefined,
    name: analyticsContext.traits?.name || event.traits?.name || undefined,
  });
  transferAsSnakeCase(user, analyticsContext.traits, ["email", "name"]);
  transferAsSnakeCase(user, event.traits, ["email", "name"]);
  const classic = {
    [TableNameParameter]: event[TableNameParameter],
    anon_ip: analyticsContext.ip ? anonymizeIp(analyticsContext.ip) : undefined,
    api_key: event.writeKey || "",
    click_id: Object.keys(click_id).length > 0 ? click_id : undefined,
    doc_encoding: analyticsContext.page?.encoding ?? event.properties?.encoding,
    doc_host: analyticsContext.page?.host ?? event.properties?.host,
    doc_path: analyticsContext.page?.path ?? event.properties?.path,
    doc_search: analyticsContext.page?.search ?? event.properties?.search,
    eventn_ctx_event_id: event.messageId,
    event_type: event.event || event.type,
    local_tz_offset: analyticsContext.page?.timezoneOffset ?? event.properties?.timezoneOffset,
    page_title: analyticsContext.page?.title,
    referer: analyticsContext.page?.referrer,
    screen_resolution:
      Object.keys(analyticsContext.screen || {}).length > 0
        ? Math.max(analyticsContext.screen.width || 0) + "x" + Math.max(analyticsContext.screen.height || 0)
        : undefined,
    source_ip: analyticsContext.ip,
    src: event.properties?.src || "jitsu",
    url: urlStr,
    user: Object.keys(user).length > 0 ? user : undefined,
    location:
      Object.keys(geo).length > 0
        ? {
            city: geo.city?.name,
            continent: geo.continent?.code,
            country: geo.country?.code,
            country_name: geo.country?.name,
            latitude: geo.location?.latitude,
            longitude: geo.location?.longitude,
            region: geo.region?.code,
            zip: geo.postalCode?.code,
            timezone: geo.location?.timezone,
            autonomous_system_number: geo.provider?.as?.num,
            autonomous_system_organization: geo.provider?.as?.name,
            isp: geo.provider?.isp,
            domain: geo.provider?.domain,
          }
        : undefined,
    ids: Object.keys(ids).length > 0 ? ids : undefined,
    parsed_ua:
      Object.keys(ua).length > 0
        ? {
            os_family: ua.os?.name,
            os_version: ua.os?.version,
            ua_family: ua.browser?.name,
            ua_version: ua.browser?.version,
            device_brand: ua.device?.vendor,
            device_type: ua.device?.type,
            device_model: ua.device?.model,
            bot: ua.bot,
          }
        : undefined,
    user_agent: analyticsContext.userAgent,
    user_language: analyticsContext.locale,
    utc_time: event.timestamp,
    _timestamp: event.receivedAt,
    utm: analyticsContext.campaign,
    vp_size:
      Object.keys(analyticsContext.screen || {}).length > 0
        ? Math.max(analyticsContext.screen.innerWidth || 0) + "x" + Math.max(analyticsContext.screen.innerHeight || 0)
        : undefined,
  };
  if (event.type === "track") {
    transferAsSnakeCase(classic, event.properties);
  } else {
    transferAsSnakeCase(classic, event.properties, [
      "url",
      "title",
      "referrer",
      "search",
      "host",
      "path",
      "width",
      "height",
    ]);
  }

  return removeUndefined(classic);
}

function fromJitsuClassic(event) {
  let type = "track";
  let eventName = undefined;
  switch ((event.event_type ?? "").toLowerCase()) {
    case "pageview":
    case "page_view":
    case "page":
      type = "page";
      eventName = event.event_type;
      break;
    case "identify":
      type = "identify";
      break;
    case "screen":
      type = "screen";
      break;
    case "group":
      type = "group";
      break;
    case "alias":
      type = "alias";
      break;
    default:
      type = "track";
      eventName = event.event_type;
      break;
  }
  const clientIds =
    Object.keys(event.ids || event.click_id || {}).length > 0
      ? {
          ga4: event.ids?.ga
            ? {
                clientId: event.ids.ga,
              }
            : undefined,
          fbp: event.ids?.fbp,
          fbc: event.ids?.fbc,
          ...event.click_id,
        }
      : undefined;
  const loc = event.location || {};
  const geo =
    Object.keys(loc).length > 0
      ? {
          city: {
            name: loc.city,
          },
          continent: {
            code: loc.continent,
          },
          country: {
            code: loc.country,
            name: loc.country_name,
          },
          location: {
            latitude: loc.latitude,
            longitude: loc.longitude,
            timezone: loc.timezone,
          },
          region: {
            code: loc.region,
          },
          postalCode: {
            code: loc.zip,
          },
          provider: {
            as: {
              num: loc.autonomous_system_number,
              name: loc.autonomous_system_organization,
            },
            isp: loc.isp,
            domain: loc.domain,
          },
        }
      : undefined;
  const traits = {};
  transferAsSnakeCase(traits, event.user, ["id", "anonymous_id"]);
  const properties = {};
  transferAsSnakeCase(properties, event, [
    TableNameParameter,
    "anon_ip",
    "api_key",
    "click_id",
    "doc_encoding",
    "doc_host",
    "doc_path",
    "doc_search",
    "eventn_ctx_event_id",
    "event_type",
    "local_tz_offset",
    "page_title",
    "referer",
    "screen_resolution",
    "source_ip",
    "url",
    "user",
    "location",
    "parsed_ua",
    "user_agent",
    "user_language",
    "utc_time",
    "_timestamp",
    "utm",
    "vp_size",
  ]);
  if (type === "page") {
    properties.url = event.url;
    properties.title = event.page_title;
    properties.referrer = event.referer;
    properties.search = event.doc_search;
    properties.host = event.doc_host;
    properties.path = event.doc_path;
    properties.width = parseInt(event.vp_size?.split("x")[0]);
    properties.height = parseInt(event.vp_size?.split("x")[1]);
  }
  const screen = {};
  const sr = event.screen_resolution?.split("x");
  if (sr?.length === 2) {
    screen.width = parseInt(sr[0]);
    screen.height = parseInt(sr[1]);
  }
  const vs = event.vp_size?.split("x");
  if (vs?.length === 2) {
    screen.innerWidth = parseInt(vs[0]);
    screen.innerHeight = parseInt(vs[1]);
  }

  return removeUndefined({
    [TableNameParameter]: event[TableNameParameter],
    messageId: event.eventn_ctx_event_id,
    userId: event.user?.id,
    anonymousId: event.user?.anonymous_id,
    timestamp: event.utc_time,
    receivedAt: event._timestamp,
    writeKey: event.api_key,
    type,
    event: eventName,
    context: {
      ip: event.source_ip,
      locale: event.user_language,
      userAgent: event.user_agent,
      page: {
        url: event.url,
        title: event.page_title,
        referrer: event.referer,
        search: event.doc_search,
        host: event.doc_host,
        path: event.doc_path,
        encoding: event.doc_encoding,
        timezoneOffset: event.local_tz_offset,
      },
      screen: Object.keys(screen).length > 0 ? screen : undefined,
      clientIds,
      campaign: event.utm,
      traits,
      geo,
    },
    properties,
    traits: type === "identify" || type === "group" ? traits : undefined,
  });
}

export { DropRetryErrorName, RetryError, RetryErrorName, TableNameParameter, fromJitsuClassic, toJitsuClassic };`;

export const chainWrapperCode = `//** @UDF_FUNCTIONS_IMPORT **//
import {
    TableNameParameter, toJitsuClassic, fromJitsuClassic, DropRetryErrorName,
    RetryError,
    RetryErrorName,
} from "@jitsu/functions-lib";

global.RetryError = RetryError;
global.TableNameParameter = TableNameParameter;
global.toJitsuClassic = toJitsuClassic;
global.fromJitsuClassic = fromJitsuClassic;

export function checkError(chainRes) {
    let errObj = undefined;
    for (const el of chainRes.execLog) {
        const error = el.error;
        if (error) {
            if (!errObj && (error.name === DropRetryErrorName || error.name === RetryErrorName)) {
                errObj = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    retryPolicy: error.retryPolicy,
                    event: chainRes.events,
                    functionId: error.functionId || el.functionId
                }
            } else {
                _jitsu_log.error.apply(undefined, [{
                    function: {
                        ..._jitsu_funcCtx.function,
                        id: error.functionId || el.functionId
                    }
                }, \`Function execution failed\`, error.name, error.message], {arguments: {copy: true}});
            }
        }
    }
    if (errObj) {
        throw new Error(JSON.stringify(errObj));
    }
}

function deepCopy(o) {
    if (typeof o !== "object") {
        return o
    }
    if (!o) {
        return o
    }

    // https://jsperf.com/deep-copy-vs-json-stringify-json-parse/25
    if (Array.isArray(o)) {
        const newO = []
        for (let i = 0; i < o.length; i += 1) {
            const v = o[i]
            newO[i] = !v || typeof v !== "object" ? v : deepCopy(v)
        }
        return newO
    }

    const newO = {}
    for (const [k, v] of Object.entries(o)) {
        newO[k] = !v || typeof v !== "object" ? v : deepCopy(v)
    }
    return newO
}

function isDropResult(result) {
    return result === "drop" || (Array.isArray(result) && result.length === 0) || result === null || result === false;
}

async function runChain(
    chain,
    event,
    ctx
) {
    const execLog = [];
    let events = [event];
    for (let k = 0; k < chain.length; k++) {
        const f = chain[k];

        const newEvents = [];
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            let result = undefined;
            // const execLogMeta = {
            //     eventIndex: i,
            //     receivedAt: rat && rat != "Invalid Date" ? rat : new Date(),
            //     functionId: f.id,
            // };
            try {
                result = await f.f(deepCopy(event), ctx);

                if (k < chain.length - 1 && Array.isArray(result) && result.length > 1) {
                    const l = result.length;
                    result = undefined;
                    throw new Error("Got " + l + " events as result of function #" + (k + 1) + " of " + chain.length + ". Only the last function in a chain is allowed to multiply events.");
                }
                // execLog.push({
                //     ...execLogMeta,
                //     ms: Date.now() - sw,
                //     dropped: isDropResult(result),
                // });
            } catch (err) {
                if (err.name === DropRetryErrorName) {
                    result = "drop";
                }
                if (f.meta?.retryPolicy) {
                    err.retryPolicy = f.meta.retryPolicy;
                }
                execLog.push({
                    functionId: f.id,
                    error: err,
                    //event,
                    // ms: Date.now() - sw,
                    // dropped: isDropResult(result),
                });
            }
            if (!isDropResult(result)) {
                if (result) {
                    // @ts-ignore
                    newEvents.push(...(Array.isArray(result) ? result : [result]));
                } else {
                    newEvents.push(event);
                }
            }
        }
        events = newEvents;
    }
    return {events, execLog};
}

const wrappedFunctionChain = async function (event, ctx) {
    let chain = [];
    //** @UDF_FUNCTIONS_CHAIN **//
    const chainRes = await runChain(chain, event, ctx);
    checkError(chainRes);
    if (Array.isArray(chainRes.events) && chainRes.events.length === 1) {
        return chainRes.events[0];
    }
    return chainRes.events;
};

const wrappedUserFunction = (id, f, funcCtx) => {

    const log = {
        info: (...args) => {
            _jitsu_log.info.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
        error: (...args) => {
            _jitsu_log.error.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
        warn: (...args) => {
            _jitsu_log.warn.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
        debug: (...args) => {
            _jitsu_log.debug.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
    }

    const store = {
        set: async (key, value, opts) => {
            await _jitsu_store.set.apply(undefined, [key, value, opts], {
                arguments: {copy: true},
                result: {promise: true}
            });
        },
        del: async key => {
            await _jitsu_store.del.apply(undefined, [key], {
                arguments: {copy: true},
                result: {promise: true}
            });
        },
        get: async key => {
            const res = await _jitsu_store.get.apply(undefined, [key], {
                arguments: {copy: true},
                result: {promise: true}
            });
            return res ? JSON.parse(res) : undefined;
        },
        ttl: async key => {
            return await _jitsu_store.ttl.apply(undefined, [key], {
                arguments: {copy: true},
                result: {promise: true}
            });
        },
    }

    const fetch = async (url, opts, extras) => {
        let res
        if (extras) {
            res = await _jitsu_fetch.apply(undefined, [url, opts, {ctx: funcCtx, event: extras.event}], {
                arguments: {copy: true},
                result: {promise: true}
            });
        } else {
            res = await _jitsu_fetch.apply(undefined, [url, opts], {
                arguments: {copy: true},
                result: {promise: true}
            });
        }
        const r = JSON.parse(res);

        return {
            ...r,
            json: async () => {
                return JSON.parse(r.body);
            },
            text: async () => {
                return r.body;
            },
            arrayBuffer: async () => {
                throw new Error("Method 'arrayBuffer' is not implemented");
            },
            blob: async () => {
                throw new Error("Method 'blob' is not implemented");
            },
            formData: async () => {
                throw new Error("Method 'formData' is not implemented");
            },
            clone: async () => {
                throw new Error("Method 'clone' is not implemented");
            },
        };
    }

    return async function (event, c) {
        const fetchLogEnabled = _jitsu_fetch_log_level !== "debug" || (funcCtx.function.debugTill && funcCtx.function.debugTill > new Date());
        let ftch = fetch
        if (fetchLogEnabled) {
            ftch = async(url, opts) => {
                return fetch(url, opts, {event});
            }
        }
        const ctx = {
            ...c,
            props: funcCtx.props,
            log,
            store,
            fetch: ftch,
        };
        return await f(event, ctx);
    }
};

export {wrappedFunctionChain};
`;
