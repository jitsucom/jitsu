import { EventContext, EventsStore, FetchOpts, FullContext, Store } from "@jitsu/protocols/functions";
import nodeFetch, { RequestInit } from "node-fetch-commonjs";
import { getErrorMessage, getLog, stopwatch } from "juava";
import { httpAgent, httpsAgent } from "./functions/lib/http-agent";
import { SystemContext } from "./functions/lib";

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
  const connectionId = eventContext.connection?.id ?? "";
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
      const timeout = 15000;
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, timeout);

      let internalInit: RequestInit = {
        ...init,
        agent: (url.startsWith("https://") ? httpsAgent : httpAgent)(),
        signal: controller.signal,
      };
      let fetchResult: any = undefined;
      try {
        fetchResult = await nodeFetch(url, internalInit);
      } catch (err: any) {
        if (err.name === "AbortError") {
          err.message = `Fetch request exceeded timeout ${timeout}ms and was aborted`;
        }
        if (logToRedis) {
          eventsStore.log(connectionId, true, { ...baseInfo, error: getErrorMessage(err), elapsedMs: sw.elapsedMs() });
        }
        throw err;
      }
      //clone response to be able to read it twice
      const cloned = fetchResult.clone();
      if (logToRedis) {
        eventsStore.log(connectionId, !fetchResult.ok, {
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
        log.atDebug().log(`[CON:${connectionId}]: [f:${id}][DEBUG]: ${message}`, ...args);
        eventsStore.log(connectionId, false, {
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
        log.atDebug().log(`[CON:${connectionId}]: [f:${id}][WARN]: ${message}`, ...args);
        eventsStore.log(connectionId, false, {
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
        eventsStore.log(connectionId, true, {
          type: "log-error",
          functionId: id,
          functionType: type,
          message: {
            text: message,
            args,
          },
        });
        const l = log.atDebug();
        if (args.length > 0) {
          const last = args[args.length - 1];
          if (last.stack) {
            l.withCause(last);
            args = args.slice(0, args.length - 1);
          }
        }
        l.log(`[CON:${connectionId}]: [f:${id}][ERROR]: ${message}`, ...args);
      },
      info: (message, ...args: any[]) => {
        log.atDebug().log(`[CON:${connectionId}]: [f:${id}][INFO]: ${message}`, ...args);
        eventsStore.log(connectionId, false, {
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
