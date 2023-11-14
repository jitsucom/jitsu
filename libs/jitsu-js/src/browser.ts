import { JitsuOptions } from "./jitsu";
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
  const queue = [];
  if (window[JITSU_V2_ID]) {
    if (Array.isArray(window[JITSU_V2_ID])) {
      //processing queue of events
      if (options.debug) {
        console.log(
          `Initializing Jitsu with prior events queue size of ${window[JITSU_V2_ID].length}`,
          window[JITSU_V2_ID]
        );
      }
      queue.push(...window[JITSU_V2_ID]);
    } else {
      console.warn("Attempted to initialize Jitsu twice. Returning the existing instance");
    }
  }
  if (options.debug) {
    console.log(`Jitsu options: `, JSON.stringify(options));
  }
  const jitsu = jitsuAnalytics(options);
  for (const [method, args] of queue) {
    if (options.debug) {
      console.log(`Processing event ${method} from Jitsu queue on`, args);
    }
    try {
      jitsu[method](...args);
    } catch (e: any) {
      console.warn(`Error processing event ${method} from Jitsu queue on`, args, e);
    }
  }

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

  //new callback based queue
  const callbackQueue = window[JITSU_V2_ID + "Q"] || [];
  if (options.debug) {
    console.log(`Jitsu callback queue size: ${callbackQueue.length}`, callbackQueue);
  }
  callbackQueue.forEach((callback: any) => {
    try {
      callback(jitsu);
    } catch (e: any) {
      console.warn(`Error processing callback from Jitsu queue`, e);
    }
  })
  if (!options.initOnly) {
    jitsu.page();
  }
})();
