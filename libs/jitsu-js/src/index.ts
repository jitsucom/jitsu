import Analytics from "analytics";
import { jitsuAnalyticsPlugin, emptyRuntime, isInBrowser, windowRuntime, uuid } from "./analytics-plugin";
import {
  Callback,
  DispatchedEvent,
  ID,
  JSONObject,
  Options,
  AnalyticsInterface,
  JitsuOptions,
  PersistentStorage,
  RuntimeFacade,
  DynamicJitsuOptions,
} from "@jitsu/protocols/analytics";

export default function parse(input) {
  let value = input;
  if (input?.indexOf("%7B%22") === 0) {
    value = decodeURIComponent(input);
  }
  try {
    value = JSON.parse(value);
    if (value === "true") return true;
    if (value === "false") return false;
    if (typeof value === "object") return value;
    if (parseFloat(value) === value) {
      value = parseFloat(value);
    }
  } catch (e) {}
  if (value === null || value === "") {
    return;
  }
  return value;
}

export const emptyAnalytics: AnalyticsInterface = {
  setAnonymousId: () => {},
  track: () => Promise.resolve(),
  page: () => Promise.resolve(),
  user: () => ({}),
  identify: () => Promise.resolve({}),
  group: () => Promise.resolve({}),
  reset: () => Promise.resolve({}),
  configure: () => {},
};

function createUnderlyingAnalyticsInstance(
  opts: JitsuOptions,
  rt: RuntimeFacade,
  plugins: any[] = []
): AnalyticsInterface {
  const storageCache: any = {};

  // AnalyticsInstance's storage is async somewhere inside. So if we make 'page' call right after 'identify' call
  // 'page' call will load traits from storage before 'identify' call had a change to save them.
  // to avoid that we use in-memory cache for storage
  const cachingStorageWrapper = (persistentStorage: PersistentStorage) => ({
    setItem(key: string, val: any) {
      if (opts.privacy?.dontSend || opts.privacy?.disableUserIds) {
        return;
      }
      if (opts.debug) {
        console.log(`[JITSU DEBUG] Caching storage setItem: ${key}=${val}`);
      }
      storageCache[key] = val;
      persistentStorage.setItem(key, val);
    },
    getItem(key: string) {
      if (opts.privacy?.dontSend || opts.privacy?.disableUserIds) {
        return;
      }
      const value = storageCache[key] || persistentStorage.getItem(key);
      if (opts.debug) {
        console.log(
          `[JITSU DEBUG] Caching storage getItem: ${key}=${value}. Evicted from cache: ${!storageCache[key]}`
        );
      }
      return value;
    },
    reset() {
      for (const key of [...Object.keys(storageCache)]) {
        delete storageCache[key];
      }
      persistentStorage.reset();
    },
    removeItem(key: string) {
      if (opts.debug) {
        console.log(`[JITSU DEBUG] Caching storage removeItem: ${key}`);
      }
      delete storageCache[key];
      persistentStorage.removeItem(key);
    },
  });
  const storage = cachingStorageWrapper(rt.store());

  const analytics = Analytics({
    debug: !!opts.debug,
    storage,
    plugins: [jitsuAnalyticsPlugin(opts, storage), ...plugins],
  } as any);

  const a = {
    ...analytics,
    page: (...args) => {
      if (args.length === 2 && typeof args[0] === "string" && typeof args[1] === "object") {
        return analytics.page({
          name: args[0],
          ...args[1],
        });
      } else {
        return (analytics.page as any)(...args);
      }
    },
    identify: (...args) => {
      if (args[0] && typeof args[0] !== "object" && typeof args[0] !== "string") {
        //fix the quirk of analytics.js: if you pass number as first argument, it will be converted to string
        args[0] = args[0] + "";
      }

      //analytics.js sets userId and traits asynchronously, so if
      //we want them to be available immediately after identify call in subsequent page() calls,
      //we need to put them into storage manually
      const storage = (analytics as any).storage;
      const storageWrapper = cachingStorageWrapper(storage);
      if (typeof args[0] === "string") {
        //first argument is user id
        storageWrapper.setItem("__user_id", args[0]);
      } else if (typeof args[0] === "object") {
        //first argument is traits
        storageWrapper.setItem("__user_traits", args[0]);
      }

      if (args.length === 2 && typeof args[1] === "object") {
        //first argument is user id, second is traits
        storageWrapper.setItem("__user_traits", args[1]);
      }
      return (analytics.identify as any)(...args);
    },
    setAnonymousId: (id: string) => {
      if (opts.debug) {
        console.log("[JITSU DEBUG] Setting anonymous id to " + id);
      }
      //Workaround for analytics.js bug. Underlying setAnonymousId doesn't  set the id immediately,
      //so we got to it manually here. See https://github.com/jitsucom/jitsu/issues/1060
      storage.setItem("__anon_id", id);
      const userState = analytics.user();
      if (userState) {
        userState.anonymousId = id;
      }
      (analytics as any).setAnonymousId(id);
    },
    async reset() {
      if (opts.debug) {
        console.log("[JITSU DEBUG] Called reset(). Storage state", JSON.stringify(analytics.user()));
      }
      storage.reset();
      await analytics.reset();
      this.setAnonymousId(uuid());
      if (opts.debug) {
        console.log("[JITSU DEBUG] User state after reset", JSON.stringify(analytics.user()));
      }
    },
    async configure(options: DynamicJitsuOptions) {
      if (opts.debug) {
        console.log("[JITSU DEBUG] Update Jitsu config with", JSON.stringify(options));
      }
      if (!!options.privacy?.disableUserIds) {
        storage.reset();
      }
      for (const plugin of Object.values(analytics.plugins)) {
        if (typeof plugin["configure"] === "function") {
          plugin["configure"](options);
        }
      }
    },
    async group(
      groupId?: ID,
      traits?: JSONObject | null,
      options?: Options,
      callback?: Callback
    ): Promise<DispatchedEvent> {
      const results: any[] = [];
      for (const plugin of Object.values(analytics.plugins)) {
        if (plugin["group"]) {
          results.push(await plugin["group"](groupId, traits, options, callback));
        }
      }
      //It's incorrect at many levels. First, it's not a dispatched event. Second, we take a first result
      //However, since returned values are used for debugging purposes only, it's ok
      return results[0];
    },
  } as AnalyticsInterface;
  if (!!opts.privacy?.disableUserIds) {
    storage.reset();
  }
  return a;
}

/**
 * Fix common mistakes in jitsu configuration
 * @param opts
 */
function fixOptions(opts: JitsuOptions): JitsuOptions {
  return {
    ...opts,
    host:
      (opts.host ?? "").indexOf("https://") !== 0 && (opts.host ?? "").indexOf("http://") !== 0
        ? `https://${opts.host}`
        : opts.host,
  };
}

export function jitsuAnalytics(_opts: JitsuOptions): AnalyticsInterface {
  const opts = fixOptions(_opts);
  const inBrowser = isInBrowser();
  const rt = opts.runtime || (inBrowser ? windowRuntime(opts) : emptyRuntime(opts));
  return createUnderlyingAnalyticsInstance(opts, rt);

  // if (inBrowser) {
  //   const fetch = opts.fetch || globalThis.fetch;
  //   if (!fetch) {
  //     throw new Error(
  //       "Please specify fetch function in jitsu plugin initialization, fetch isn't available in global scope"
  //     );
  //   }
  //   const url = `${opts.host}/api/s/cfg`;
  //   const authHeader = {};
  //   const debugHeader = opts.debug ? { "X-Enable-Debug": "true" } : {};
  //   fetch(url)
  //     .then(res => res.json())
  //     .then(res => {
  //       result.loaded(createUnderlyingAnalyticsInstance(opts, rt, []));
  //     })
  //     .catch(e => {
  //       console.warn(`[JITSU] error getting device-destinations from ${url}`, e);
  //       result.loaded(createUnderlyingAnalyticsInstance(opts, rt));
  //     });
  // } else {
  //   result.loaded(createUnderlyingAnalyticsInstance(opts, rt));
  // }
}

export {
  Callback,
  DispatchedEvent,
  ID,
  JSONObject,
  Options,
  AnalyticsInterface,
  JitsuOptions,
  PersistentStorage,
  RuntimeFacade,
  DynamicJitsuOptions,
};
export * from "./analytics-plugin";
