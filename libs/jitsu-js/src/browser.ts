import type { AnalyticsInterface, JitsuOptions } from "@jitsu/protocols/analytics";
import { jitsuAnalytics } from "./index";

export type JitsuBrowserOptions = {
  namespace?: string;
  userId?: string;
  onload?: string;
  initOnly?: boolean;
} & JitsuOptions;

function snakeToCamel(s: string) {
  return s.replace(/([-_][a-z])/gi, $1 => {
    return $1.toUpperCase().replace("-", "").replace("_", "");
  });
}

export type Parser = (arg: string) => any;
const booleanParser = (arg: string) => arg === "true" || arg === "1" || arg === "yes";

const parsers: Partial<Record<keyof JitsuBrowserOptions, Parser>> = {
  debug: booleanParser,
  enableThirdPartIds: booleanParser,
  enableAnonymousId: booleanParser,
  enabled: booleanParser,
  echoEvents: booleanParser,
  initOnly: booleanParser,
};

function getParser(name: keyof JitsuBrowserOptions): Parser {
  return parsers[name] || (x => x);
}

function getScriptAttributes(scriptElement: HTMLScriptElement) {
  return scriptElement
    .getAttributeNames()
    .filter(name => name.indexOf("data-") === 0)
    .map(name => name.substring("data-".length))
    .reduce(
      (res, name) => ({
        ...res,
        [snakeToCamel(name)]: getParser(snakeToCamel(name) as any)(scriptElement.getAttribute(`data-${name}`)),
      }),
      {}
    );
}

function runCallback(callback: any, jitsu: AnalyticsInterface) {
  if (typeof callback === "function") {
    callback(jitsu);
  } else if (Array.isArray(callback) && typeof callback[0] === "string") {
    const [method, ...args] = callback;
    if (typeof jitsu[method] === "function") {
      jitsu[method](...args);
    } else {
      console.warn(`Method ${method} is not supported, ignoring callback`);
    }
  } else {
    console.warn(`Invalid jitsu queue callback`, callback);
  }
}

(function () {
  function readJitsuOptions(): JitsuBrowserOptions {
    const scriptElement = window.document.currentScript as HTMLScriptElement;
    if (!scriptElement) {
      throw new Error(`Can't find script element`);
    }
    const host = new URL(scriptElement.src).origin;

    return { ...((window as any)?.jitsuConfig || {}), ...getScriptAttributes(scriptElement), host };
  }

  const options = readJitsuOptions();
  const JITSU_V2_ID: string = options.namespace || "jitsu";
  if (options.debug) {
    console.log(`Jitsu options: `, JSON.stringify(options));
  }
  const jitsu = jitsuAnalytics(options);

  if (options.onload) {
    const onloadFunction = window[options.onload] as any;
    if (!onloadFunction) {
      console.warn(`onload function ${options.onload} is not found in window`);
    }
    if (typeof onloadFunction === "function") {
      onloadFunction(jitsu);
    } else {
      console.warn(`onload function ${options.onload} is not callable: ${typeof onloadFunction}`);
    }
  }
  window[JITSU_V2_ID] = jitsu;

  /**
   * New callback based queue, see below
   */
  //make a copy of the queue
  const callbackQueue =
    window[JITSU_V2_ID + "Q"] && window[JITSU_V2_ID + "Q"].length ? [...window[JITSU_V2_ID + "Q"]] : [];
  //replace push with a function that calls callback immediately
  window[JITSU_V2_ID + "Q"] = {
    push: (callback: any) => {
      if (typeof callback === "function") {
        callback(jitsu);
      } else {
        console.warn(`${JITSU_V2_ID}Q.push() accepts only function, ${typeof callback} given`);
      }
    },
  };

  if (options.debug) {
    console.log(`[JITSU DEBUG] Jitsu callback queue size: ${callbackQueue.length}`, callbackQueue);
  }
  callbackQueue.forEach((callback: any) => {
    try {
      runCallback(callback, jitsu);
    } catch (e: any) {
      console.warn(`Error processing callback from Jitsu queue`, e);
    }
  });
  if (!options.initOnly) {
    jitsu.page();
  }
})();
