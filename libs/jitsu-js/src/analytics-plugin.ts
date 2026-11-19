/* global analytics */

import {
  AnalyticsClientEvent,
  Callback,
  DynamicJitsuOptions,
  ErrorHandler,
  ID,
  JitsuOptions,
  JSONObject,
  Options,
  PersistentStorage,
  RuntimeFacade,
  Traits,
} from "@jitsu/protocols/analytics";
import parse from "./index";

import { AnalyticsInstance, AnalyticsPlugin } from "analytics";
import { loadScript } from "./script-loader";
import { internalDestinationPlugins } from "./destination-plugins";
import { jitsuLibraryName, jitsuVersion } from "./version";
import { getTopLevelDomain } from "./tlds";
import * as jsondiffpatch from "jsondiffpatch";

const diff = jsondiffpatch.create();

const defaultConfig = {
  /* Your segment writeKey */
  writeKey: undefined,
  /* Disable anonymous MTU */
  host: undefined,
  debug: false,
  fetch: undefined,
  echoEvents: false,
  cookieDomain: undefined,
  cookieNames: {},
  cookieCapture: {},
  runtime: undefined,
  fetchTimeoutMs: undefined,
  s2s: undefined,
  idEndpoint: undefined,
  errorPolicy: "log" as const,
  defaultPayloadContext: {},
  privacy: {
    dontSend: false,
    disableUserIds: false,
    ipPolicy: "keep" as const,
    consentCategories: {},
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
          consentCategories: { ...defaultConfig.privacy.consentCategories },
          ...current.privacy,
          ...value,
        };
      } else if (typeof value === "undefined") {
        if (newConfig.hasOwnProperty("privacy") || !current.hasOwnProperty("privacy")) {
          // explicitly set to undefined - reset to default
          // or was not set at all - set to default
          current.privacy = {
            ...defaultConfig.privacy,
            consentCategories: { ...defaultConfig.privacy.consentCategories },
          };
        }
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

export type StorageFactory = (cookieDomain: string, key2Cookie: (key: string) => string) => PersistentStorage;

function getCookie(name: string) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  return parts.length === 2 ? parts.pop()?.split(";").shift() : undefined;
}

//Google Ads auto-tagging appends these to the landing page URL. Google's own conversion linker
//stores gclid in _gcl_aw and dclid in _gcl_dc as `GCL.<timestamp>.<id>`, so we read the cookies too
//- that keeps the id available on later page views, but only when the customer also runs gtag.
const googleClickIdCookies = {
  gclid: "_gcl_aw",
  dclid: "_gcl_dc",
};

function parseGclCookie(cookieValue: string | undefined) {
  if (typeof cookieValue !== "string" || !cookieValue) {
    return undefined;
  }
  //`GCL.1712345678.SomeClickId` - the id is everything after the timestamp, and may itself
  //contain dots, so only the first two segments are dropped.
  const parts = cookieValue.split(".");
  return parts.length >= 3 ? parts.slice(2).join(".") : undefined;
}

function getGoogleClickIds(runtime: RuntimeFacade, query: Record<string, string>) {
  const clickIds = {};
  //URL params win: they're the authoritative value for this click, and they work whether or not
  //gtag is installed. gbraid/wbraid have no documented cookie, so the URL is the only source.
  for (const name of ["gclid", "gbraid", "wbraid", "dclid"]) {
    if (query[name]) {
      clickIds[name] = query[name];
    }
  }
  for (const [key, cookieName] of Object.entries(googleClickIdCookies)) {
    if (!clickIds[key]) {
      const fromCookie = parseGclCookie(runtime.getCookie(cookieName));
      if (fromCookie) {
        clickIds[key] = fromCookie;
      }
    }
  }
  return clickIds;
}

function getClientIds(
  runtime: RuntimeFacade,
  customCookieCapture: Record<string, string>,
  query: Record<string, string>
) {
  const cookieCapture = {
    fbc: "_fbc",
    fbp: "_fbp",
    ...customCookieCapture,
  };
  const clientIds = Object.entries(cookieCapture).reduce((acc, [key, cookieName]) => {
    acc[key] = runtime.getCookie(cookieName);
    return acc;
  }, {});
  return {
    ...clientIds,
    ...getGoogleClickIds(runtime, query),
    ...getGa4Ids(runtime),
  };
}

function parseGa4SessionId(cookieValue: string) {
  if (typeof cookieValue !== "string") {
    return undefined;
  }
  if (cookieValue.startsWith("GA1") || cookieValue.startsWith("GS1")) {
    return cookieValue.split(".")[2];
  } else {
    // parse new GA4 cookie format, e.g.: GS2.1.s1747323152$o28$g0$t1747323152$j60$l0$h69286059
    const match = cookieValue.match(/^GS\d+\.\d+\.(?:[\w_-]+[$])*s(\d+)(?:$|[$])/);
    return match ? match[1] : undefined;
  }
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
              const sessionId = parseGa4SessionId(value);
              if (!sessionId) {
                return null;
              }
              return [key.substring("_ga_".length), sessionId];
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
  __user_id: "__eventn_uid",
  __user_traits: "__eventn_id_usr",
  __group_id: "__group_id",
  __group_traits: "__group_traits",
};

const cookieStorage: StorageFactory = (cookieDomain, key2cookie) => {
  return {
    setItem(key: string, val: any) {
      const cookieName = key2cookie(key) || key;
      if (typeof val === "undefined") {
        removeCookie(cookieName, {
          domain: cookieDomain,
          secure: window.location.protocol === "https:",
        });
        return;
      }
      const strVal = typeof val === "object" && val !== null ? encodeURIComponent(JSON.stringify(val)) : val;
      setCookie(cookieName, strVal, {
        domain: cookieDomain,
        secure: window.location.protocol === "https:",
      });
    },
    getItem(key: string) {
      const cookieName = key2cookie(key) || key;
      const result = getCookie(cookieName);
      if (key === "__anon_id") {
        //anonymous id must always be a string, so we don't parse it to preserve its exact value
        return result;
      }
      if (typeof result === "undefined" && key === "__user_id") {
        //backward compatibility with old jitsu cookie. get user id if from traits
        const traits = parse(getCookie(key2cookie("__user_traits") || "__eventn_id_usr")) || {};
        return traits.internal_id || traits.user_id || traits.id || traits.userId;
      }
      return parse(result);
    },
    removeItem(key: string) {
      removeCookie(key2cookie(key) || key, {
        domain: cookieDomain,
        secure: window.location.protocol === "https:",
      });
    },
    reset() {
      for (const key of Object.keys(defaultCookie2Key)) {
        removeCookie(key2cookie(key) || key, {
          domain: cookieDomain,
          secure: window.location.protocol === "https:",
        });
      }
    },
  };
};

type ViewportSize = { innerWidth: number; innerHeight: number };
type ViewportCache = {
  document: Document;
  visualViewport: VisualViewport | null;
  size?: ViewportSize;
  signature?: string;
  measuredResize?: Event;
  observer?: MutationObserver;
  onVisibilityChange: () => void;
  onResize: (event: Event) => void;
};
const viewports = new WeakMap<Window, ViewportCache>();
/**
 * zone.js, which Angular runs on, wraps addEventListener, setTimeout and requestAnimationFrame, and runs change
 * detection after every callback registered inside its zone. The viewport cache needs none of that, so it registers
 * through the unpatched originals that zone.js saves under __zone_symbol__ names, and uses the plain functions
 * everywhere else.
 */
function unzoned(target: any, name: string): Function | undefined {
  const saved = target?.["__zone_symbol__" + name];
  return typeof saved === "function" ? saved : target?.[name];
}
function listen(target: any, method: "addEventListener" | "removeEventListener", type: string, listener: any) {
  unzoned(target, method)?.call(target, type, listener, true);
}
function startTimer(browserWindow: Window, callback: () => void, ms: number): number {
  return unzoned(browserWindow, "setTimeout")!.call(browserWindow, callback, ms);
}
function stopTimer(browserWindow: Window, timer: number) {
  unzoned(browserWindow, "clearTimeout")?.call(browserWindow, timer);
}
function nextFrame(browserWindow: Window, callback: () => void) {
  unzoned(browserWindow, "requestAnimationFrame")!.call(browserWindow, callback);
}

/** How long the viewport has to stay unchanged before the cache is refilled. */
const REMEASURE_QUIET_MS = 100;
const remeasures = new WeakMap<Window, { generation: number; timer?: number }>();

/**
 * Refills the cache once the viewport has been quiet for a moment and the browser has rendered a frame. Layout is
 * clean by then, so the read costs nothing and the next send finds a warm cache instead of paying for the layout
 * itself. Every invalidation restarts the wait, so a drag or a scroll that resizes on every frame costs one read
 * at the end, not one per frame. Does nothing without the timing APIs, and skips hidden documents.
 */
function remeasureWhenQuiet(browserWindow: Window) {
  if (
    typeof browserWindow.requestAnimationFrame !== "function" ||
    typeof browserWindow.setTimeout !== "function" ||
    typeof browserWindow.clearTimeout !== "function"
  ) {
    return;
  }
  let state = remeasures.get(browserWindow);
  if (!state) {
    state = { generation: 0 };
    remeasures.set(browserWindow, state);
  }
  const current = state;
  const generation = ++current.generation;
  if (current.timer !== undefined) {
    stopTimer(browserWindow, current.timer);
  }
  current.timer = startTimer(
    browserWindow,
    () => {
      current.timer = undefined;
      nextFrame(browserWindow, () =>
        startTimer(
          browserWindow,
          () => {
            // a newer invalidation owns the next measurement
            if (current.generation === generation && !browserWindow.document?.hidden) {
              getViewportSize(browserWindow);
            }
          },
          0
        )
      );
    },
    REMEASURE_QUIET_MS
  );
}

function createViewportCache(browserWindow: Window): ViewportCache {
  const cache: ViewportCache = {
    document: browserWindow.document,
    visualViewport: browserWindow.visualViewport,
    onVisibilityChange: () => {
      cache.size = undefined;
      remeasureWhenQuiet(browserWindow);
    },
    onResize: event => {
      if (event.target === event.currentTarget && (!event.isTrusted || event !== cache.measuredResize)) {
        cache.size = undefined;
        remeasureWhenQuiet(browserWindow);
      }
    },
  };
  if (cache.document) {
    cache.observer = new MutationObserver(() => {
      cache.size = undefined;
      remeasureWhenQuiet(browserWindow);
    });
    cache.observer.observe(cache.document, { childList: true });
  }
  viewports.set(browserWindow, cache);
  return cache;
}

/**
 * The content of every viewport meta tag, in document order. The browser applies the one processed last, wherever it
 * sits in the document and however its name is capitalised, so a tag added to the body or after the first one changes
 * the viewport. The live meta collection is cached by the browser, which keeps this cheap. A selector would search the
 * whole tree on every send.
 */
function viewportMetaContents(doc: Document | undefined): string | undefined {
  const metas = doc?.getElementsByTagName?.("meta");
  if (!metas) {
    return undefined;
  }
  const contents: (string | null)[] = [];
  for (let i = 0; i < metas.length; i++) {
    if (metas[i].getAttribute("name")?.toLowerCase() === "viewport") {
      contents.push(metas[i].getAttribute("content"));
    }
  }
  // encoded as a list, so where one tag ends and the next begins is part of the signature, and a tag without a content
  // attribute differs from one with an empty one
  return JSON.stringify(contents);
}

/**
 * Readings that cost nothing, because none of them needs layout, and that move together with the viewport: the
 * window size, the pixel ratio (page zoom), the screen orientation and the viewport meta tag. Unlike a listener,
 * comparing them works whichever handler runs first, so a send from an application handler that runs ahead of
 * the SDK's own listeners still notices a change. visualViewport.scale is left out on purpose: reading it forces
 * layout in WebKit.
 */
function viewportSignature(browserWindow: Window): string {
  const orientation = browserWindow.screen?.orientation;
  return [
    browserWindow.outerWidth,
    browserWindow.outerHeight,
    browserWindow.devicePixelRatio,
    orientation?.type,
    orientation?.angle,
    viewportMetaContents(browserWindow.document),
  ].join("|");
}

/** Inside an iframe the size is always read live and nothing is cached. */
function isInFrame(browserWindow: Window): boolean {
  return !!browserWindow.parent && browserWindow.parent !== browserWindow;
}

function readViewportSize(browserWindow: Window): ViewportSize {
  return { innerWidth: browserWindow.innerWidth, innerHeight: browserWindow.innerHeight };
}

function getViewportSize(browserWindow: Window): ViewportSize {
  const doc = browserWindow.document;
  if (
    // A host can resize its iframe and send before the browser delivers any resize event.
    isInFrame(browserWindow) ||
    typeof browserWindow.addEventListener !== "function" ||
    (doc && (typeof Document === "undefined" || !(doc instanceof Document) || typeof MutationObserver !== "function"))
  ) {
    return readViewportSize(browserWindow);
  }
  let cache = viewports.get(browserWindow);
  if (!cache || cache.document !== doc) {
    if (cache) {
      cache.observer?.disconnect();
      listen(cache.document, "removeEventListener", "visibilitychange", cache.onVisibilityChange);
      listen(browserWindow, "removeEventListener", "resize", cache.onResize);
      listen(cache.visualViewport, "removeEventListener", "resize", cache.onResize);
    }
    cache = createViewportCache(browserWindow);
  }
  // A document rewrite clears window listeners, even if it restores the same root.
  // takeRecords also catches a synchronous send before observer delivery.
  if (cache.observer?.takeRecords().length) cache.size = undefined;
  if (!cache.size) {
    listen(doc, "addEventListener", "visibilitychange", cache.onVisibilityChange);
    listen(browserWindow, "addEventListener", "resize", cache.onResize);
    // Safari can change innerWidth/innerHeight during pinch zoom with only a visual viewport resize.
    listen(cache.visualViewport, "addEventListener", "resize", cache.onResize);
  }
  // Hidden documents can enter the back-forward cache. Keep the next visible send fresh,
  // even when the first SDK call was made by a pagehide or visibilitychange handler.
  if (doc?.hidden) return readViewportSize(browserWindow);
  // The viewport can change before any listener has heard of it, for example when an application handler that
  // runs ahead of ours sends an event. The signature moves with the viewport and costs nothing to read.
  if (cache.size && cache.signature !== viewportSignature(browserWindow)) cache.size = undefined;
  const event = browserWindow.event;
  // An earlier handler can send before invalidation. A browser-generated Event is
  // unique to its dispatch, whereas scripts can immediately reuse the same Event.
  const resize =
    event?.type === "resize" && (event.target === browserWindow || event.target === cache.visualViewport)
      ? event
      : undefined;
  if (!cache.size || (resize && (!resize.isTrusted || resize !== cache.measuredResize))) {
    cache.size = readViewportSize(browserWindow);
    cache.signature = viewportSignature(browserWindow);
    cache.measuredResize = resize?.isTrusted ? resize : undefined;
  }
  return cache.size;
}

/**
 * Fills the viewport cache shortly after start-up, once a frame has rendered. A page that sends nothing until its
 * first user interaction then starts with a warm cache instead of paying for the layout in that first send.
 */
export function warmViewportCache() {
  // nothing is cached in an iframe, so a measurement there would be discarded
  if (isInBrowser() && !isInFrame(window)) {
    remeasureWhenQuiet(window);
  }
}

const viewportKeys = ["innerWidth", "innerHeight"] as const;

/**
 * analytics.js builds the default `width`/`height` page properties by reading `window.innerWidth` and
 * `window.innerHeight` inside its own code, before any SDK code can intervene. After a DOM change those reads
 * force a synchronous layout. That read happens synchronously inside `analytics.page()`, so for the duration
 * of `fn` the two properties return the SDK's cached viewport instead.
 *
 * Each property is served from the cache exactly once and its original descriptor is put back by its own
 * getter. analytics.js reads both back to back and only afterwards dispatches `pageStart` to plugins and
 * listeners, so they run against the real window. Whatever was not read is restored before `fn` returns.
 *
 * Falls back to calling `fn` untouched when there is no window or the properties can't be redefined.
 */
export function withCachedViewport<T>(fn: () => T): T {
  if (!isInBrowser()) {
    return fn();
  }
  const win = window as any;
  const size = getViewportSize(win);
  const shadowed = new Set<(typeof viewportKeys)[number]>();
  const original = {} as Record<(typeof viewportKeys)[number], PropertyDescriptor | undefined>;
  const restore = (key: (typeof viewportKeys)[number]) => {
    if (!shadowed.delete(key)) {
      return;
    }
    if (original[key]) {
      Object.defineProperty(win, key, original[key]!);
    } else {
      delete win[key];
    }
  };
  const restoreAll = () => viewportKeys.forEach(restore);
  try {
    for (const key of viewportKeys) {
      original[key] = Object.getOwnPropertyDescriptor(win, key);
      Object.defineProperty(win, key, {
        configurable: true,
        enumerable: true,
        get: () => {
          restore(key);
          return size[key];
        },
      });
      shadowed.add(key);
    }
  } catch (e) {
    restoreAll();
    return fn();
  }
  try {
    return fn();
  } finally {
    restoreAll();
  }
}

export function windowRuntime(opts: JitsuOptions): RuntimeFacade {
  const key2Cookie = (key: string) => {
    switch (key) {
      case "__anon_id":
        return opts.cookieNames?.anonymousId || defaultCookie2Key.__anon_id;
      case "__user_id":
        return opts.cookieNames?.userId || defaultCookie2Key.__user_id;
      case "__user_traits":
        return opts.cookieNames?.userTraits || defaultCookie2Key.__user_traits;
      case "__group_id":
        return opts.cookieNames?.groupId || defaultCookie2Key.__group_id;
      case "__group_traits":
        return opts.cookieNames?.groupTraits || defaultCookie2Key.__group_traits;
      default:
        return key;
    }
  };
  return {
    getCookie(name: string): string | undefined {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      return parts.length === 2 ? parts.pop()?.split(";").shift() : undefined;
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
      return cookieStorage(opts.cookieDomain || getTopLevelDomain(window.location.hostname), key2Cookie);
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
      const viewport = getViewportSize(window);
      return {
        width: window.screen.width,
        height: window.screen.height,
        innerWidth: viewport.innerWidth,
        innerHeight: viewport.innerHeight,
        density: Math.floor(window.devicePixelRatio),
      };
    },
    userAgent(): string {
      return window.navigator.userAgent;
    },
  };
}

export function createInMemoryStorage(debug?: boolean): PersistentStorage {
  const storage = {};
  return {
    reset(): void {
      Object.keys(storage).forEach(key => delete storage[key]);
    },
    setItem(key: string, val: any) {
      if (debug) {
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
      if (debug) {
        console.log(`[JITSU EMPTY RUNTIME] Get storage item ${key}=${JSON.stringify(val)}`);
      }
      return val;
    },
    removeItem(key: string) {
      if (debug) {
        console.log(`[JITSU EMPTY RUNTIME] Get storage item ${key}=${storage[key]}`);
      }
      delete storage[key];
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
    return createInMemoryStorage(config.debug);
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

function deepCopy(o) {
  if (typeof o !== "object") {
    return o;
  }
  if (!o) {
    return o;
  }
  return JSON.parse(JSON.stringify(o));
}

function deepMerge(target: any, source: any) {
  if (typeof source !== "object" || source === null || Array.isArray(source) || source instanceof Date) {
    return source;
  }
  if (typeof target !== "object" || target === null || Array.isArray(target) || target instanceof Date) {
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
 * Synchronously checks for the presence of the anonymous ID cookie and creates one if not present.
 * This should be called at the earliest possible stage to ensure the cookie is available
 * immediately (e.g., for server-side reading on the very first page load).
 */
export function ensureAnonymousId(opts: JitsuOptions): string | undefined {
  if (!isInBrowser()) {
    return undefined;
  }
  const cookieName = opts.cookieNames?.anonymousId || defaultCookie2Key.__anon_id;
  const existing = getCookie(cookieName);
  if (existing) {
    return existing;
  }
  const id = uuid();
  const domain = opts.cookieDomain || getTopLevelDomain(window.location.hostname);
  setCookie(cookieName, id, {
    domain,
    secure: window.location.protocol === "https:",
  });
  if (opts.debug) {
    console.log(
      `[JITSU DEBUG] preInitAnonymousId: created anonymous ID cookie '${cookieName}'=${id} on domain '${domain}'`
    );
  }
  return id;
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

function canonicalUrl() {
  if (!isInBrowser()) return;
  const tags = document.getElementsByTagName("link");
  for (var i = 0, tag; (tag = tags[i]); i++) {
    if (tag.getAttribute("rel") === "canonical") {
      return tag.getAttribute("href");
    }
  }
}

/**
 * bugged analytics.js logic that produces 'url' parameter by concating canonical URL with current search part
 * I produces broken results in some cases like SPA where path is changed but canonical URL is not updated
 */
function analyticsJsUrl() {
  if (!isInBrowser()) return;
  const canonical = canonicalUrl();
  if (!canonical) return window.location.href.replace(hashRegex, "");
  return canonical.match(/\?/) ? canonical : canonical + window.location.search;
}

function adjustPayload(
  payload: any,
  config: JitsuOptions,
  storage: PersistentStorage,
  s2s: boolean
): AnalyticsClientEvent {
  const runtime: RuntimeFacade = config.runtime || (isInBrowser() ? windowRuntime(config) : emptyRuntime(config));
  const url = runtime.pageUrl();
  const parsedUrl = url ? safeCall(() => new URL(url), undefined) : undefined;
  const query = parsedUrl ? parseQuery(parsedUrl.search) : {};
  const properties = payload.properties || {};

  if (payload.type === "page" && (properties.url || url)) {
    // we don't trust analytics.js URL logic since it's sticks with canonical URL on SPA pages
    let targetUrl = url || properties.url;
    if (properties.url && properties.url !== analyticsJsUrl()) {
      // properties.url is not the same as provided by analytics.js
      // it means that it was not overridden by user and we should use it
      targetUrl = properties.url;
    }
    properties.url = targetUrl.replace(hashRegex, "");
    properties.path = fixPath(urlPath(targetUrl));
    // other properties are correctly based on window.location in analytics.js
  }

  const customContext = deepMerge(
    config.defaultPayloadContext,
    payload.properties?.context || payload.options?.context || {}
  );
  delete payload.properties?.context;
  const referrer = runtime.referrer();
  const context: AnalyticsClientEvent["context"] = {
    library: {
      name: jitsuLibraryName,
      version: jitsuVersion,
      env: isInBrowser() ? "browser" : "node",
    },
    consent:
      typeof config.privacy?.consentCategories === "object" && Object.keys(config.privacy?.consentCategories).length
        ? {
            categoryPreferences: config.privacy.consentCategories,
          }
        : undefined,
    userAgent: runtime.userAgent?.(),
    headers: runtime.headers?.(),
    locale: runtime.language?.(),
    screen: runtime.screen?.(),
    ip: runtime?.ip?.(),
    traits:
      payload.type != "identify" && payload.type != "group"
        ? {
            ...(restoreTraits(storage) || {}),
            ...(payload?.options?.traits || {}),
          }
        : undefined,
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
    clientIds: !config.privacy?.disableUserIds ? getClientIds(runtime, config.cookieCapture || {}, query) : undefined,
    campaign: parseUtms(query),
  };
  const withContext = {
    ...payload,
    userId: payload?.options?.userId || payload?.userId,
    anonymousId: payload?.options?.anonymousId || payload?.anonymousId,
    groupId: payload?.options?.groupId || storage.getItem("__group_id"),
    timestamp: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    messageId: randomId(properties.path || (parsedUrl && parsedUrl.pathname)),
    writeKey: maskWriteKey(config.writeKey),
    context: deepMerge(context, customContext),
  };
  delete withContext.meta;
  delete withContext.options;
  if (config.privacy?.disableUserIds) {
    delete withContext.userId;
    delete withContext.anonymousId;
    delete withContext.context.traits;
    delete withContext.groupId;
  }
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
    let newEvents: AnalyticsClientEvent[] = [];
    if (destination.newEvents) {
      try {
        newEvents = destination.newEvents.map(e =>
          e === "same" ? deepCopy(originalEvent) : isDiff(e) ? diff.patch(deepCopy(originalEvent), e.__diff) : e
        );
      } catch (e) {
        console.error(`[JITSU] Error applying '${destination.id}' changes to event: ${e?.message}`, e);
      }
    } else {
      newEvents = [deepCopy(originalEvent)];
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

function getErrorHandler(opts: JitsuOptions): ErrorHandler {
  const configuredHandler = opts.errorPolicy || "log";
  if (typeof configuredHandler === "function") {
    return configuredHandler;
  } else if (configuredHandler === "rethrow") {
    return (msg, ...args) => {
      //ignore args, not clear what to do with them
      throw new Error(msg);
    };
  } else {
    return (msg, ...args) => {
      console.error(msg, ...args);
    };
  }
}

async function send(
  method,
  payload,
  jitsuConfig: JitsuOptions,
  instance: AnalyticsInstance,
  store: PersistentStorage,
  isAutoIdentify?: boolean
): Promise<any> {
  const s2s = !!jitsuConfig.s2s;
  const debugHeader = jitsuConfig.debug ? { "X-Enable-Debug": "true" } : {};
  const adjustedPayload = adjustPayload(payload, jitsuConfig, store, s2s);
  if (jitsuConfig.echoEvents) {
    console.log(`[JITSU DEBUG] sending '${method}' event:`, adjustedPayload);
    return;
  }
  const url = s2s ? `${jitsuConfig.host}/api/s/s2s/${method}` : `${jitsuConfig.host}/api/s/${method}`;
  const fetch = jitsuConfig.fetch || globalThis.fetch;
  if (!fetch) {
    //don't run it through error handler since error is critical and should be addressed
    throw new Error(
      "Please specify fetch function in jitsu plugin initialization, fetch isn't available in global scope"
    );
  }
  const abortController = jitsuConfig.fetchTimeoutMs ? new AbortController() : undefined;
  const abortTimeout = jitsuConfig.fetchTimeoutMs
    ? setTimeout(() => {
        abortController?.abort();
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
      } as HeadersInit,
      body: JSON.stringify(adjustedPayload),
      signal: abortController?.signal,
    });
    if (abortTimeout) {
      clearTimeout(abortTimeout);
    }
  } catch (e: any) {
    const errorHandler = isAutoIdentify ? msg => console.warn(msg) : getErrorHandler(jitsuConfig);
    errorHandler(`Call to ${url} failed with error ${e.message}`);
    return Promise.resolve();
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
    const errorHandler = isAutoIdentify ? msg => console.warn(msg) : getErrorHandler(jitsuConfig);
    errorHandler(
      `Call to ${url} failed with error: ${fetchResult.status} - ${fetchResult.statusText}: ${responseText}`
    );
    return Promise.resolve();
  }

  let responseJson: any;
  try {
    responseJson = JSON.parse(responseText);
  } catch (e) {
    const errorHandler = isAutoIdentify ? msg => console.warn(msg) : getErrorHandler(jitsuConfig);
    errorHandler(`Can't parse JSON: ${responseText}: ${e?.message}`);
    return Promise.resolve();
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

const controllingTraits = ["$doNotSend"] as const;

/**
 * Remove all members of traits that controls identify/group behavior (see analytics.d.ts), and should not be recorded. Returns
 * copy of the object with these members removed.
 *
 * Do not modify traits object, but creates one
 * @param traits
 */
function stripControllingTraits(traits: Traits): Exclude<Traits, (typeof controllingTraits)[number]> {
  const res = { ...traits };
  // see Traits definition in analytics.d.ts. We cannot define const here, so here's a little code duplication
  for (const key of controllingTraits) {
    delete res[key];
  }
  return res;
}

export const jitsuAnalyticsPlugin = (jitsuOptions: JitsuOptions = {}, storage: PersistentStorage): AnalyticsPlugin => {
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
      if (config.privacy?.dontSend) {
        return;
      }
      const promise = send("page", payload, config, instance, storage);
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {});
      }
      return promise;
    },
    track: args => {
      const { payload, config, instance } = args;
      if (config.privacy?.dontSend) {
        return;
      }
      const promise = send("track", payload, config, instance, storage);
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {});
      }
      return promise;
    },
    identify: args => {
      const { payload, config, instance } = args;
      if (config.privacy?.dontSend || config.privacy?.disableUserIds) {
        return;
      }
      // Store traits in cache to be able to use them in page and track events that run asynchronously with current identify.
      storage.setItem("__user_id", payload.userId);
      const doNotSend = payload.traits?.$doNotSend;
      if (payload.traits && typeof payload.traits === "object") {
        payload.traits = stripControllingTraits(payload.traits);
        storage.setItem("__user_traits", payload.traits);
      }
      if (doNotSend) {
        return Promise.resolve();
      }
      const isAutoIdentify = payload.options?.autoIdentify === true;
      const promise = send("identify", payload, config, instance, storage, isAutoIdentify);
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {});
      }
      return promise;
    },
    reset: args => {
      const { config, instance } = args;
      storage.reset();
      if (config.debug) {
        console.log("[JITSU DEBUG] Resetting Jitsu plugin storage");
      }
    },
    methods: {
      //analytics doesn't support group as a base method, so we need to add it manually
      configure(newOptions: DynamicJitsuOptions) {
        const idsWasDisabled = jitsuOptions.privacy?.disableUserIds || jitsuOptions.privacy?.dontSend;
        mergeConfig(jitsuOptions, newOptions);
        const idsDisabledNow = jitsuOptions.privacy?.disableUserIds || jitsuOptions.privacy?.dontSend;
        if (!idsDisabledNow && idsWasDisabled) {
          if (jitsuOptions.debug) {
            console.log("[JITSU] Enabling Anonymous ID. Generating new Id.");
          }
          const instance = (this as any).instance;
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
        if (jitsuOptions.privacy?.dontSend || jitsuOptions.privacy?.disableUserIds) {
          return;
        }
        if (typeof groupId === "number") {
          //fix potential issues with group id being used incorrectly
          groupId = groupId + "";
        }

        const instance = (this as any).instance;
        const user = instance.user();
        const userId = options?.userId || user?.userId;
        const anonymousId = options?.anonymousId || user?.anonymousId || storage.getItem("__anon_id");
        storage.setItem("__group_id", groupId);
        const doNotSend = traits?.$doNotSend;
        if (traits && typeof traits === "object") {
          traits = stripControllingTraits(traits);
          storage.setItem("__group_traits", traits);
        }
        if (doNotSend) {
          return Promise.resolve();
        }
        return send(
          "group",
          { type: "group", groupId, traits, ...(anonymousId ? { anonymousId } : {}), ...(userId ? { userId } : {}) },
          jitsuOptions,
          instance,
          storage
        );
      },
    },
  };
};

let seedCounter = 0;

function getSeed() {
  seedCounter = (seedCounter + 1) % Number.MAX_SAFE_INTEGER;

  const defaultSeed = Date.now() % 2147483647;
  const seed = isInBrowser() ? window?.performance?.now() || defaultSeed : defaultSeed;

  return seed + seedCounter;
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
