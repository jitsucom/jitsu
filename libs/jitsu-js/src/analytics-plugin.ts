/* global analytics */

import {
  DynamicJitsuOptions,
  JitsuOptions,
  PersistentStorage,
  RuntimeFacade,
  AnalyticsClientEvent,
  Callback,
  ID,
  JSONObject,
  Options,
} from "@jitsu/protocols/analytics";
import parse from "./index";

import { AnalyticsInstance, AnalyticsPlugin } from "analytics";
import { loadScript } from "./script-loader";
import { internalDestinationPlugins } from "./destination-plugins";
import { jitsuLibraryName, jitsuVersion } from "./version";
import { getTopLevelDomain } from "./tlds";
import * as jsondiffpatch from "jsondiffpatch";

const diff = jsondiffpatch.create();

const defaultConfig: Required<JitsuOptions> = {
  /* Your segment writeKey */
  writeKey: null,
  /* Disable anonymous MTU */
  host: null,
  debug: false,
  fetch: null,
  echoEvents: false,
  cookieDomain: undefined,
  runtime: undefined,
  fetchTimeoutMs: undefined,
  s2s: undefined,
  idEndpoint: undefined,
  privacy: {
    dropEvents: false,
    disableAnonymousId: false,
    disableThirdPartIds: false,
    ipPolicy: "keep",
    consentCategories: undefined,
  },
};

// mergeConfig merges newConfig into currentConfig also making sure that all undefined values are replaced with defaultConfig values
const mergeConfig = (current: JitsuOptions, newConfig: JitsuOptions): void => {
  for (const key of Object.keys(defaultConfig)) {
    const value = newConfig[key];
    if (key === "privacy") {
      if (typeof value === "object") {
        current.privacy = {
          ...defaultConfig.privacy,
          ...current.privacy,
          ...value,
        };
      } else {
        current.privacy = { ...defaultConfig.privacy };
      }
    } else if (typeof value === "undefined") {
      if (newConfig.hasOwnProperty(key) || !current.hasOwnProperty(key)) {
        // explicitly set to undefined - reset to default
        // or was not set at all - set to default
        current[key] = defaultConfig[key];
      }
    } else {
      current[key] = value;
    }
  }
};

export const parseQuery = (qs?: string): Record<string, string> => {
  if (!qs) {
    return {};
  }
  let queryString = qs.length > 0 && qs.charAt(0) === "?" ? qs.substring(1) : qs;
  let query: Record<string, string> = {};
  let pairs = (queryString[0] === "?" ? queryString.substr(1) : queryString).split("&");
  for (let i = 0; i < pairs.length; i++) {
    let pair = pairs[i].split("=");
    query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
  }
  return query;
};

function utmToKey(key) {
  const name = key.substring("utm_".length);
  return name === "campaign" ? "name" : name;
}

function parseUtms(query: Record<string, string>) {
  return Object.entries(query)
    .filter(([key]) => key.indexOf("utm_") === 0)
    .reduce(
      (acc, [key, value]) => ({
        ...acc,
        [utmToKey(key)]: value,
      }),
      {}
    );
}

function safeCall<T>(f: () => T, defaultVal?: T): T | undefined {
  try {
    return f();
  } catch (e) {
    return defaultVal;
  }
}

function restoreTraits(storage: PersistentStorage) {
  let val = storage.getItem("__user_traits");
  if (typeof val === "string") {
    val = safeCall(() => JSON.parse(val), {});
  }
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    val = {};
  }
  let groupVal = storage.getItem("__group_traits");
  if (typeof groupVal === "string") {
    groupVal = safeCall(() => JSON.parse(groupVal), {});
  }
  if (typeof groupVal !== "object" || groupVal === null || Array.isArray(groupVal)) {
    groupVal = {};
  }
  return {
    ...(groupVal || {}),
    ...(val || {}), //user traits override group traits
  };
}

export type StorageFactory = (cookieDomain: string, cookie2key: Record<string, string>) => PersistentStorage;

function getCookie(name: string) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  return parts.length === 2 ? parts.pop().split(";").shift() : undefined;
}

function getGa4Ids(runtime: RuntimeFacade) {
  const allCookies = runtime.getCookies();
  const clientId = allCookies["_ga"]?.split(".").slice(-2).join(".");
  const gaSessionCookies = Object.entries(allCookies).filter(([key]) => key.startsWith("_ga_"));
  const sessionIds =
    gaSessionCookies.length > 0
      ? Object.fromEntries(
          gaSessionCookies
            .map(([key, value]) => {
              if (typeof value !== "string") {
                return null;
              }
              const parts = value.split(".");
              if (parts.length < 3) {
                return null;
              }
              return [key.substring("_ga_".length), parts[2]];
            })
            .filter(v => v !== null)
        )
      : undefined;
  if (clientId || sessionIds) {
    return { ga4: { clientId, sessionIds } };
  } else {
    return undefined;
  }
}

function removeCookie(name: string, { domain, secure }: { domain: string; secure: boolean }) {
  document.cookie =
    name +
    "=;domain=" +
    domain +
    ";path=/" +
    ";expires=Thu, 01 Jan 1970 00:00:01 GMT;SameSite=" +
    (secure ? "None" : "Lax") +
    (secure ? ";secure" : "");
}

function setCookie(name: string, val: string, { domain, secure }: { domain: string; secure: boolean }) {
  document.cookie =
    name +
    "=" +
    val +
    ";domain=" +
    domain +
    ";path=/" +
    ";expires=" +
    new Date(new Date().getTime() + 1000 * 60 * 60 * 24 * 365 * 5).toUTCString() +
    ";SameSite=" +
    (secure ? "None" : "Lax") +
    (secure ? ";secure" : "");
}

const defaultCookie2Key = {
  __anon_id: "__eventn_id",
  __user_traits: "__eventn_id_usr",
  __user_id: "__eventn_uid",
};

const cookieStorage: StorageFactory = (cookieDomain, key2cookie) => {
  return {
    setItem(key: string, val: any) {
      if (typeof val === "undefined") {
        removeCookie(key2cookie[key] || key, {
          domain: cookieDomain,
          secure: window.location.protocol === "https:",
        });
        return;
      }
      const strVal = typeof val === "object" && val !== null ? encodeURIComponent(JSON.stringify(val)) : val;
      const cookieName = key2cookie[key] || key;
      setCookie(cookieName, strVal, {
        domain: cookieDomain,
        secure: window.location.protocol === "https:",
      });
    },
    getItem(key: string) {
      const cookieName = key2cookie[key] || key;
      const result = getCookie(cookieName);
      if (typeof result === "undefined" && key === "__user_id") {
        //backward compatibility with old jitsu cookie. get user id if from traits
        const traits = parse(getCookie("__eventn_id_usr")) || {};
        return traits.internal_id || traits.user_id || traits.id || traits.userId;
      }
      return parse(result);
    },
    removeItem(key: string) {
      removeCookie(key2cookie[key] || key, {
        domain: cookieDomain,
        secure: window.location.protocol === "https:",
      });
    },
    reset() {
      for (const v of Object.values(key2cookie)) {
        removeCookie(v, {
          domain: cookieDomain,
          secure: window.location.protocol === "https:",
        });
      }
    },
  };
};

export function windowRuntime(opts: JitsuOptions): RuntimeFacade {
  return {
    getCookie(name: string): string | undefined {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      return parts.length === 2 ? parts.pop().split(";").shift() : undefined;
    },
    getCookies(): Record<string, string> {
      const value = `; ${document.cookie}`;
      const cookies: Record<string, string> = {};
      const matches = value.matchAll(/(\w+)=([^;]+)/g);
      for (const match of matches) {
        cookies[match[1]] = match[2];
      }
      return cookies;
    },
    documentEncoding(): string | undefined {
      return window.document.characterSet;
    },
    timezoneOffset(): number | undefined {
      return new Date().getTimezoneOffset();
    },
    store(): PersistentStorage {
      return cookieStorage(opts.cookieDomain || getTopLevelDomain(window.location.hostname), defaultCookie2Key);
    },

    language(): string {
      return window.navigator.language;
    },
    pageTitle(): string {
      return window.document.title;
    },
    pageUrl(): string {
      return window.location.href;
    },
    referrer(): string {
      return window.document.referrer;
    },
    screen(): { width: number; height: number; innerWidth: number; innerHeight: number; density: number } {
      return {
        width: window.screen.width,
        height: window.screen.height,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        density: Math.floor(window.devicePixelRatio),
      };
    },
    userAgent(): string {
      return window.navigator.userAgent;
    },
  };
}

export const emptyRuntime = (config: JitsuOptions): RuntimeFacade => ({
  documentEncoding(): string | undefined {
    return undefined;
  },
  timezoneOffset(): number | undefined {
    return undefined;
  },
  getCookie(name: string): string | undefined {
    return undefined;
  },
  getCookies(): Record<string, string> {
    return {};
  },

  store(): PersistentStorage {
    const storage = {};
    return {
      reset(): void {
        Object.keys(storage).forEach(key => delete storage[key]);
      },
      setItem(key: string, val: any) {
        if (config.debug) {
          console.log(`[JITSU EMPTY RUNTIME] Set storage item ${key}=${JSON.stringify(val)}`);
        }
        if (typeof val === "undefined") {
          delete storage[key];
        } else {
          storage[key] = val;
        }
      },
      getItem(key: string) {
        const val = storage[key];
        if (config.debug) {
          console.log(`[JITSU EMPTY RUNTIME] Get storage item ${key}=${JSON.stringify(val)}`);
        }
        return val;
      },
      removeItem(key: string) {
        if (config.debug) {
          console.log(`[JITSU EMPTY RUNTIME] Get storage item ${key}=${storage[key]}`);
        }
        delete storage[key];
      },
    };
  },
  language() {
    return undefined;
  },
  pageTitle() {
    return undefined;
  },
  pageUrl() {
    return undefined;
  },
  referrer() {
    return undefined;
  },
  screen() {
    return undefined;
  },
  userAgent() {
    return undefined;
  },
});

function deepMerge(target: any, source: any) {
  if (typeof source !== "object" || source === null) {
    return source;
  }
  if (typeof target !== "object" || target === null) {
    return source;
  }
  return Object.entries(source).reduce((acc, [key, value]) => {
    acc[key] = deepMerge(target[key], value);
    return acc;
  }, target);
}

export function isInBrowser() {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

/**
 * Fixes a weird bug in analytics URL where path
 * of https://test.com becomes //test.com
 */
function fixPath(path: string): string {
  if (path.indexOf("//") === 0 && path.lastIndexOf("/") === 1) {
    return "/";
  }
  return path;
}

const hashRegex = /#.*$/;

/**
 * for compatibility with path produced by analytics.js
 * @param url
 */
function urlPath(url) {
  const regex = /(http[s]?:\/\/)?([^\/\s]+\/)(.*)/g;
  const matches = regex.exec(url);
  const pathMatch = matches && matches[3] ? matches[3].split("?")[0].replace(hashRegex, "") : "";
  return "/" + pathMatch;
}

function adjustPayload(
  payload: any,
  config: JitsuOptions,
  storage: PersistentStorage,
  s2s: boolean
): AnalyticsClientEvent {
  const runtime: RuntimeFacade = config.runtime || (isInBrowser() ? windowRuntime(config) : emptyRuntime(config));
  const url = runtime.pageUrl();
  const parsedUrl = safeCall(() => new URL(url), undefined);
  const query = parsedUrl ? parseQuery(parsedUrl.search) : {};
  const properties = payload.properties || {};

  if (payload.type === "page" && url) {
    properties.url = url.replace(hashRegex, "");
    properties.path = fixPath(urlPath(url));
  }

  const customContext = payload.properties?.context || {};
  delete payload.properties?.context;
  const referrer = runtime.referrer();
  const context: AnalyticsClientEvent["context"] = {
    library: {
      name: jitsuLibraryName,
      version: jitsuVersion,
      env: s2s ? "node" : "browser",
    },
    consent: config.privacy?.consentCategories
      ? {
          categoryPreferences: config.privacy.consentCategories,
        }
      : undefined,
    userAgent: runtime.userAgent(),
    locale: runtime.language(),
    screen: runtime.screen(),
    traits: payload.type != "identify" && payload.type != "group" ? { ...(restoreTraits(storage) || {}) } : undefined,
    page: {
      path: properties.path || (parsedUrl && parsedUrl.pathname),
      referrer: referrer,
      referring_domain: safeCall(() => referrer && new URL(referrer).hostname),
      host: parsedUrl && parsedUrl.host,
      search: properties.search || (parsedUrl && parsedUrl.search),
      title: properties.title || runtime.pageTitle(),
      url: properties.url || url,
      encoding: properties.encoding || runtime.documentEncoding(),
    },
    clientIds: !config.privacy?.disableThirdPartIds
      ? {
          fbc: runtime.getCookie("_fbc"),
          fbp: runtime.getCookie("_fbp"),
          ...getGa4Ids(runtime),
        }
      : undefined,
    campaign: parseUtms(query),
  };
  const withContext = {
    ...payload,
    timestamp: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    messageId: randomId(properties.path || (parsedUrl && parsedUrl.pathname)),
    writeKey: maskWriteKey(config.writeKey),
    groupId: storage.getItem("__group_id"),
    context: deepMerge(context, customContext),
  };
  delete withContext.meta;
  delete withContext.options;
  return withContext;
}

export type DestinationDescriptor = {
  id: string;
  destinationType: string;
  credentials: any;
  options: any;
  newEvents?: any[];
  deviceOptions: DeviceOptions;
};
export type AnalyticsPluginDescriptor = {
  type: "analytics-plugin";
  packageCdn: string;
  moduleVarName: string;
};

export type InternalPluginDescriptor = {
  type: "internal-plugin";
  name: string;
};

export type DeviceOptions = AnalyticsPluginDescriptor | InternalPluginDescriptor;

function isDiff(obj: any) {
  const keys = Object.keys(obj);
  return keys.length === 1 && keys[0] === "__diff";
}

async function processDestinations(
  destinations: DestinationDescriptor[],
  method: string,
  originalEvent: AnalyticsClientEvent,
  debug: boolean,
  analyticsInstance: AnalyticsInstance
) {
  const promises: Promise<any>[] = [];

  for (const destination of destinations) {
    let newEvents = [originalEvent];
    if (destination.newEvents) {
      try {
        newEvents = destination.newEvents.map(e =>
          e === "same" ? originalEvent : isDiff(e) ? diff.patch(originalEvent, e.__diff) : e
        );
      } catch (e) {
        console.error(`[JITSU] Error applying '${destination.id}' changes to event: ${e?.message}`, e);
      }
    }
    const credentials = { ...destination.credentials, ...destination.options };

    if (destination.deviceOptions.type === "internal-plugin") {
      const plugin = internalDestinationPlugins[destination.deviceOptions.name];
      if (plugin) {
        for (const event of newEvents) {
          try {
            promises.push(plugin.handle({ ...credentials, debug }, event));
          } catch (e) {
            console.warn(
              `[JITSU] Error processing event with internal plugin '${destination.deviceOptions.name}': ${e?.message}`,
              e
            );
          }
        }
      } else {
        console.warn(
          `[JITSU] Unknown internal plugin '${destination.deviceOptions.name}' for destination '${destination.id}'`
        );
      }
    } else if (destination.deviceOptions.type === "analytics-plugin") {
      await loadScript(destination.deviceOptions.packageCdn);
      const plugin = window[destination.deviceOptions.moduleVarName];
      if (!plugin) {
        console.warn(
          `[JITSU] Broken plugin '${destination.deviceOptions.packageCdn}' for destination '${destination.id}' - it doesn't export '${destination.deviceOptions.moduleVarName}' variable`
        );
      } else {
        let pluginInstance: any;
        try {
          pluginInstance = (typeof plugin === "function" ? plugin : plugin.init)(credentials);
        } catch (e) {
          console.warn(
            `[JITSU] Error creating plugin '${destination.deviceOptions.moduleVarName}@${destination.deviceOptions.packageCdn}' for destination '${destination.id}': ${e?.message}`,
            e
          );
        }
        try {
          if (debug) {
            console.log(
              `[JITSU] Plugin '${destination.deviceOptions.moduleVarName}@${destination.deviceOptions.packageCdn}' for destination '${destination.id}' initialized with config:`,
              pluginInstance.config
            );
          }
          pluginInstance.initialize({ config: pluginInstance.config, instance: analyticsInstance });
        } catch (e) {
          console.warn(
            `[JITSU] Error initializing plugin '${destination.deviceOptions.moduleVarName}@${
              destination.deviceOptions.packageCdn
            }' for destination '${destination.id}': ${e?.message}. Config: ${JSON.stringify(pluginInstance.config)}`,
            e
          );
          continue;
        }

        if (pluginInstance[method]) {
          for (const event of newEvents) {
            try {
              pluginInstance[method]({
                payload: event,
                config: pluginInstance.config,
                instance: analyticsInstance,
              });
            } catch (e) {
              console.warn(
                `[JITSU] Error processing ${method}() with plugin '${destination.deviceOptions.moduleVarName}@${destination.deviceOptions.packageCdn}' for destination '${destination.id}': ${e?.message}`,
                e
              );
            }
          }
        }
      }
    }
  }
}

function looksLikeCuid(id: string) {
  return id.length === 25 && id.charAt(0) === "c";
}

function validateWriteKey(writeKey?: string): string | undefined {
  if (writeKey) {
    const [, secret] = writeKey.split(":", 2);
    if (!secret && !looksLikeCuid(writeKey)) {
      throw new Error(
        `Legacy write key detected - ${writeKey}! This format doesn't work anymore, it should be 'key:secret'. Please download a new key from Jitsu UI`
      );
    }
  }
  return writeKey;
}

function maskWriteKey(writeKey?: string): string | undefined {
  if (writeKey) {
    const [id, secret] = writeKey.split(":", 2);
    if (secret) {
      return `${id}:***`;
    } else {
      return "***";
    }
  }
  return writeKey;
}

async function send(
  method,
  payload,
  jitsuConfig: JitsuOptions,
  instance: AnalyticsInstance,
  store: PersistentStorage
): Promise<any> {
  if (jitsuConfig.echoEvents) {
    console.log(`[JITSU DEBUG] sending '${method}' event:`, payload);
    return;
  }
  const s2s = jitsuConfig.s2s === undefined ? !isInBrowser() : jitsuConfig.s2s;
  const url = s2s ? `${jitsuConfig.host}/api/s/s2s/${method}` : `${jitsuConfig.host}/api/s/${method}`;
  const fetch = jitsuConfig.fetch || globalThis.fetch;
  if (!fetch) {
    throw new Error(
      "Please specify fetch function in jitsu plugin initialization, fetch isn't available in global scope"
    );
  }
  const debugHeader = jitsuConfig.debug ? { "X-Enable-Debug": "true" } : {};

  // if (jitsuConfig.debug) {
  //   console.log(`[JITSU] Sending event to ${url}: `, JSON.stringify(payload, null, 2));
  // }
  const adjustedPayload = adjustPayload(payload, jitsuConfig, store, s2s);
  const abortController = jitsuConfig.fetchTimeoutMs ? new AbortController() : undefined;
  const abortTimeout = jitsuConfig.fetchTimeoutMs
    ? setTimeout(() => {
        abortController.abort();
      }, jitsuConfig.fetchTimeoutMs)
    : undefined;

  const authHeader = jitsuConfig.writeKey ? { "X-Write-Key": jitsuConfig.writeKey } : {};
  const ipHeader =
    typeof jitsuConfig.privacy?.ipPolicy === "undefined" || jitsuConfig.privacy?.ipPolicy === "keep"
      ? {}
      : { "X-IP-Policy": jitsuConfig.privacy.ipPolicy };
  let fetchResult;
  try {
    fetchResult = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
        ...debugHeader,
        ...ipHeader,
      },
      body: JSON.stringify(adjustedPayload),
      signal: abortController?.signal,
    });
    if (abortTimeout) {
      clearTimeout(abortTimeout);
    }
  } catch (e: any) {
    throw new Error(`Calling ${url} failed: ${e.message}`);
  }
  let responseText;
  try {
    responseText = await fetchResult.text();
  } catch (e) {
    console.warn(
      `Can't read response text from ${url} (status - ${fetchResult.status}  ${fetchResult.statusText}): ${e?.message}`
    );
  }
  if (jitsuConfig.debug) {
    console.log(
      `[JITSU DEBUG] ${url} replied ${fetchResult.status}: ${responseText}. Original payload:\n${JSON.stringify(
        adjustedPayload,
        null,
        2
      )}`
    );
  }
  if (!fetchResult.ok) {
    throw new Error(`Jitsu ${url} replied ${fetchResult.status} - ${fetchResult.statusText}: ${responseText}`);
  }

  let responseJson: any;
  try {
    responseJson = JSON.parse(responseText);
  } catch (e) {
    return Promise.reject(`Can't parse JSON: ${responseText}: ${e?.message}`);
  }

  if (responseJson.destinations && responseJson.destinations.length > 0) {
    if (jitsuConfig.s2s) {
      console.warn(
        `[JITSU] ${payload.type} responded with list of ${responseJson.destinations.length} destinations. However, this code is running in server-to-server mode, so destinations will be ignored`,
        jitsuConfig.debug ? JSON.stringify(responseJson.destinations, null, 2) : undefined
      );
    } else {
      //double protection, ingest should not return destinations in s2s mode
      if (isInBrowser()) {
        if (jitsuConfig.debug) {
          console.log(`[JITSU] Processing device destinations: `, JSON.stringify(responseJson.destinations, null, 2));
        }
        return processDestinations(responseJson.destinations, method, adjustedPayload, !!jitsuConfig.debug, instance);
      }
    }
  }
  return adjustedPayload;
}

export const jitsuAnalyticsPlugin = (
  jitsuOptions: JitsuOptions = {},
  storageWrapper?: (persistentStorage: PersistentStorage) => PersistentStorage
): AnalyticsPlugin => {
  // just to make sure that all undefined values are replaced with defaultConfig values
  mergeConfig(jitsuOptions, jitsuOptions);
  return {
    name: "jitsu",
    config: jitsuOptions,

    initialize: async args => {
      const { config } = args;
      if (config.debug) {
        console.debug("[JITSU DEBUG] Initializing Jitsu plugin with config: ", JSON.stringify(config, null, 2));
      }
      if (!config.host && !config.echoEvents) {
        throw new Error("Please specify host variable in jitsu plugin initialization, or set echoEvents to true");
      }
      validateWriteKey(config.writeKey);

      if (config.idEndpoint) {
        if (!isInBrowser()) {
          console.error(`[JITSU] 'idEndpoint' option can be used only in browser environment`);
          return;
        }
        try {
          const fetch = config.fetch || globalThis.fetch;
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 1000);
          const domain = config.cookieDomain || getTopLevelDomain(window.location.hostname);
          const res = await fetch(config.idEndpoint + "?domain=" + encodeURIComponent(domain), {
            credentials: "include",
            signal: controller.signal,
          });
          if (!res.ok) {
            console.error(`[JITSU] Can't fetch idEndpoint: ${res.status} - ${res.statusText}`);
          } else if (config.debug) {
            console.log(`[JITSU DEBUG] Fetch idEndpoint: ${res.status}`);
          }
        } catch (e) {
          console.error(`[JITSU] Can't fetch idEndpoint: ${e.message}`);
        }
      }
    },
    page: args => {
      const { payload, config, instance } = args;
      if (config.privacy?.dropEvents) {
        return;
      }
      return send(
        "page",
        payload,
        config,
        instance,
        storageWrapper ? storageWrapper(instance.storage) : instance.storage
      );
    },
    track: args => {
      const { payload, config, instance } = args;
      if (config.privacy?.dropEvents) {
        return;
      }
      return send(
        "track",
        payload,
        config,
        instance,
        storageWrapper ? storageWrapper(instance.storage) : instance.storage
      );
    },
    identify: args => {
      const { payload, config, instance } = args;
      if (config.privacy?.dropEvents) {
        return;
      }
      // Store traits in cache to be able to use them in page and track events that run asynchronously with current identify.
      const storage = storageWrapper ? storageWrapper(instance.storage) : instance.storage;
      storage.setItem("__user_id", payload.userId);
      if (payload.traits && typeof payload.traits === "object") {
        storage.setItem("__user_traits", payload.traits);
      }
      return send("identify", payload, config, instance, storage);
    },
    reset: args => {
      const { config, instance } = args;
      const storage = storageWrapper ? storageWrapper(instance.storage) : instance.storage;
      storage?.reset();
      if (config.debug) {
        console.log("[JITSU DEBUG] Resetting Jitsu plugin storage");
      }
    },
    methods: {
      //analytics doesn't support group as a base method, so we need to add it manually
      configure(newOptions: DynamicJitsuOptions) {
        const anonymousIdWasDisabled = !!jitsuOptions.privacy?.disableAnonymousId;
        mergeConfig(jitsuOptions, newOptions);
        if (!jitsuOptions.privacy?.disableAnonymousId && anonymousIdWasDisabled) {
          if (jitsuOptions.debug) {
            console.log("[JITSU] Enabling Anonymous ID. Generating new Id.");
          }
          const instance = (this as any).instance;
          const storage = storageWrapper ? storageWrapper(instance.storage) : instance.storage;
          const newAnonymousId = uuid();
          const userState = instance.user();
          if (userState) {
            userState.anonymousId = newAnonymousId;
          }
          storage.setItem("__anon_id", newAnonymousId);
          instance.setAnonymousId(newAnonymousId);
        }
      },
      group(groupId?: ID, traits?: JSONObject | null, options?: Options, callback?: Callback) {
        if (jitsuOptions.privacy?.dropEvents) {
          return;
        }
        if (typeof groupId === "number") {
          //fix potential issues with group id being used incorrectly
          groupId = groupId + "";
        }

        const instance = (this as any).instance;
        const cacheWrap = storageWrapper ? storageWrapper(instance.storage) : instance.storage;
        const user = instance.user();
        const userId = options?.userId || user?.userId;
        const anonymousId = options?.anonymousId || user?.anonymousId || cacheWrap.getItem("__anon_id");
        cacheWrap.setItem("__group_id", groupId);
        if (traits && typeof traits === "object") {
          cacheWrap.setItem("__group_traits", traits);
        }
        return send(
          "group",
          { type: "group", groupId, traits, ...(anonymousId ? { anonymousId } : {}), ...(userId ? { userId } : {}) },
          jitsuOptions,
          instance,
          cacheWrap
        );
      },
    },
  };
};

function getSeed() {
  const defaultSeed = Date.now() % 2147483647;
  return isInBrowser() ? window?.performance?.now() || defaultSeed : defaultSeed;
}

export function randomId(hashString: string | undefined = ""): string {
  const d = Date.now();
  return (
    ((Math.random() * d * hash(hashString ?? "", getSeed())) % Number.MAX_SAFE_INTEGER).toString(36) +
    ((Math.random() * d * hash(hashString ?? "", getSeed())) % Number.MAX_SAFE_INTEGER).toString(36)
  );
}

export function uuid() {
  var u = "",
    m = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
    i = 0,
    rb = (Math.random() * 0xffffffff) | 0;

  while (i++ < 36) {
    var c = m[i - 1],
      r = rb & 0xf,
      v = c == "x" ? r : (r & 0x3) | 0x8;

    u += c == "-" || c == "4" ? c : v.toString(16);
    rb = i % 8 == 0 ? (Math.random() * 0xffffffff) | 0 : rb >> 4;
  }
  return u;
}

function hash(str: string, seed: number = 0): number {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
