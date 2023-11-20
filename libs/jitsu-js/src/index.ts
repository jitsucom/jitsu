import Analytics from "analytics";
import { AnalyticsInterface, JitsuOptions, RuntimeFacade } from "./jitsu";
import jitsuAnalyticsPlugin, { emptyRuntime, isInBrowser, windowRuntime } from "./analytics-plugin";
import { Callback, DispatchedEvent, ID, JSONObject, Options } from "@jitsu/protocols/analytics";

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
};

function createUnderlyingAnalyticsInstance(
  opts: JitsuOptions,
  rt: RuntimeFacade,
  plugins: any[] = []
): AnalyticsInterface {
  const storage = rt.store();
  const analytics = Analytics({
    app: "test",
    debug: !!opts.debug,
    storage,
    plugins: [jitsuAnalyticsPlugin(opts), ...plugins],
  } as any);
  const originalPage = analytics.page;
  analytics.page = (...args) => {
    if (args.length === 2 && typeof args[0] === "string" && typeof args[1] === "object") {
      return originalPage({
        name: args[0],
        ...args[1],
      });
    } else {
      return originalPage(...args);
    }
  };
  return {
    ...analytics,
    identify: (...args) => {
      if (args[0] && typeof args[0] !== "object" && typeof args[0] !== "string") {
        //fix the quirk of analytics.js: if you pass number as first argument, it will be converted to string
        args[0] = args[0] + "";
      }
      return (analytics.identify as any)(...args);
    },
    setAnonymousId: (id: string) => {
      if (opts.debug) {
        console.log("[JITSU DEBUG] Setting anonymous id to " + id);
        //Workaround for analytics.js bug. Underlying setAnonymousId doesn't work set the id immediately,
        //so we got to it manually here. See https://github.com/jitsucom/jitsu/issues/1060
        storage.setItem("__anon_id", id);
        const userState = analytics.user();
        if (userState) {
          userState.anonymousId = id;
        }
        (analytics as any).setAnonymousId(id);
      }
    },
    group(groupId?: ID, traits?: JSONObject | null, options?: Options, callback?: Callback): Promise<DispatchedEvent> {
      for (const plugin of Object.values(analytics.plugins)) {
        if (plugin["group"]) {
          plugin["group"](groupId, traits, options, callback);
        }
      }
      return Promise.resolve({});
    },
  } as AnalyticsInterface;
}

export function jitsuAnalytics(opts: JitsuOptions): AnalyticsInterface {
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

export * from "./jitsu";
export * from "./analytics-plugin";
