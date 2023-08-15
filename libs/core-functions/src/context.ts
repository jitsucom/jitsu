import { EventContext, EventsStore, FetchOpts, FullContext, Store, SystemContext } from "@jitsu/protocols/functions";
import nodeFetch, { RequestInit } from "node-fetch-commonjs";
import { getErrorMessage, getLog, stopwatch } from "juava";
import { httpAgent, httpsAgent } from "./functions/lib/http-agent";

const log = getLog("functions-context");

export function createFullContext(
  functionId: string,
  eventsStore: EventsStore,
  store: Store,
  eventContext: EventContext,
  systemContext: SystemContext | {} = {},
  props: Record<string, any> = {},
  event?: any
): FullContext {
  const ar = functionId.split(".");
  const id = ar.pop();
  const type = ar.join(".");
  return {
    props: props,
    store: store,
    async fetch(url: string, init?: FetchOpts, logToRedis: boolean = true): Promise<Response> {
      //capture execution time
      const sw = stopwatch();
      const baseInfo = {
        functionId: id,
        functionType: type,
        type: "http-request",
        url: url,
        method: init?.method || "GET",
        body: init?.body,
        headers: init?.headers ? hideSensitiveHeaders(init.headers) : undefined,
        event: event,
      };
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 30000);

      let internalInit: RequestInit = {
        ...init,
        agent: (url.startsWith("https://") ? httpsAgent : httpAgent)(),
        signal: controller.signal,
      };
      let fetchResult: any = undefined;
      try {
        fetchResult = await nodeFetch(url, internalInit);
      } catch (err) {
        if (logToRedis) {
          eventsStore.log(true, { ...baseInfo, error: getErrorMessage(err), elapsedMs: sw.elapsedMs() });
        }
        throw err;
      }
      //clone response to be able to read it twice
      const cloned = fetchResult.clone();
      if (logToRedis) {
        eventsStore.log(!fetchResult.ok, {
          ...baseInfo,
          status: fetchResult.status,
          statusText: fetchResult.statusText,
          elapsedMs: sw.elapsedMs(),
          response: await tryJson(cloned),
        });
      }

      return fetchResult;
    },
    log: {
      debug: (message, ...args: any[]) => {
        log.atDebug().log(`[CON:${eventContext.connection?.id}]: [f:${id}]: ${message}`, ...args);
        eventsStore.log(false, {
          type: "log-debug",
          functionId: id,
          functionType: type,
          message: {
            text: message,
            args,
          },
        });
      },
      warn: (message, ...args: any[]) => {
        log.atWarn().log(`[CON:${eventContext.connection?.id}]: [f:${id}]: ${message}`, ...args);
        eventsStore.log(false, {
          type: "log-warn",
          functionId: id,
          functionType: type,
          message: {
            text: message,
            args,
          },
        });
      },
      error: (message, ...args: any[]) => {
        eventsStore.log(true, {
          type: "log-error",
          functionId: id,
          functionType: type,
          message: {
            text: message,
            args: args.map(a => `${a}`),
          },
        });
        const l = log.atError();
        if (args.length > 0) {
          const last = args[args.length - 1];
          if (last.stack) {
            l.withCause(last);
            args = args.slice(0, args.length - 1);
          }
        }
        l.log(`[CON:${eventContext.connection?.id}]: [f:${id}]: ${message}`, ...args);
      },
      info: (message, ...args: any[]) => {
        log.atInfo().log(`[CON:${eventContext.connection?.id}]: [f:${id}]: ${message}`, ...args);
        eventsStore.log(false, {
          type: "log-info",
          functionId: id,
          functionType: type,
          message: {
            text: message,
            args,
          },
        });
      },
    },
    ...eventContext,
    ...systemContext,
  };
}

function hideSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    result[k] = k.toLowerCase().includes("authorization") || k.toLowerCase().includes("token") ? "*****" : v;
  }
  return result;
}

async function tryJson(fetchResult: Response): Promise<any> {
  const text = await fetchResult.text();
  const maxLen = 1000;
  try {
    return JSON.parse(text);
  } catch (err) {
    if (text.length < maxLen) {
      return text;
    } else {
      return `${text.substring(0, maxLen)} ... [truncated, length: ${text.length}]`;
    }
  }
}
