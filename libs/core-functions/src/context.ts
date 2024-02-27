import { EventContext, FetchOpts, FullContext, Store } from "@jitsu/protocols/functions";
import { getErrorMessage, getLog, LogLevel, newError, stopwatch } from "juava";
import { SystemContext } from "./functions/lib";

const log = getLog("functions-context");

/**
 * Store for incoming events, destination results and function log messages
 */
export interface EventsStore {
  log(connectionId: string, level: LogLevel, msg: Record<string, any>): void;
  close(): void;
}

export function MultiEventsStore(stores: EventsStore[]): EventsStore {
  return {
    log(connectionId: string, level: LogLevel, msg: Record<string, any>): void {
      for (const store of stores) {
        store.log(connectionId, level, msg);
      }
    },
    close(): void {
      for (const store of stores) {
        store.close();
      }
    },
  };
}

export function createFullContext(
  functionId: string,
  eventsStore: EventsStore,
  store: Store,
  eventContext: EventContext,
  systemContext: SystemContext | {} = {},
  props: Record<string, any> = {},
  event?: any,
  fetchTimeoutMs: number = 5000
): FullContext {
  const ar = functionId.split(".");
  const id = ar.pop();
  const type = ar.join(".");
  const connectionId = eventContext.connection?.id ?? "";
  const debugEnabled = new Date(eventContext.connection.options.debugTill ?? 0) > new Date();
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
      }, fetchTimeoutMs);

      let internalInit: RequestInit = {
        ...init,
        keepalive: true,
        signal: controller.signal,
      };
      let fetchResult: any = undefined;
      try {
        fetchResult = await fetch(url, internalInit);
      } catch (err: any) {
        if (err.name === "AbortError") {
          err = newError(`Fetch request exceeded timeout ${fetchTimeoutMs}ms and was aborted`, err);
        }
        const elapsedMs = sw.elapsedMs();
        if (debugEnabled) {
          if (logToRedis) {
            eventsStore.log(connectionId, "debug", { ...baseInfo, error: getErrorMessage(err), elapsedMs: elapsedMs });
          }
          log
            .atDebug()
            .log(
              `[CON:${connectionId}]: [f:${id}][ERROR][FETCH]: ${url} Error: ${getErrorMessage(
                err
              )} ElapsedMs: ${elapsedMs}`
            );
        }
        throw err;
      }
      const elapsedMs = sw.elapsedMs();

      //clone response to be able to read it twice
      const cloned = fetchResult.clone();
      const respText = await trimResponse(cloned);
      if (debugEnabled) {
        if (logToRedis) {
          eventsStore.log(connectionId, "debug", {
            ...baseInfo,
            status: fetchResult.status,
            statusText: fetchResult.statusText,
            elapsedMs: elapsedMs,
            response: tryJson(respText),
          });
        }
        if (fetchResult.status >= 300) {
          log
            .atDebug()
            .log(
              `[CON:${connectionId}]: [f:${id}][ERROR][FETCH]: ${url} Status: ${fetchResult.status} Response: ${respText} ElapsedMs: ${elapsedMs}`
            );
        }
      }

      return fetchResult;
    },
    log: {
      debug: (message, ...args: any[]) => {
        if (debugEnabled) {
          log.atDebug().log(`[CON:${connectionId}]: [f:${id}][DEBUG]: ${message}`, ...args);
          eventsStore.log(connectionId, "debug", {
            type: "log-debug",
            functionId: id,
            functionType: type,
            message: {
              text: message,
              args,
            },
          });
        }
      },
      warn: (message, ...args: any[]) => {
        log.atWarn().log(`[CON:${connectionId}]: [f:${id}][WARN]: ${message}`, ...args);
        eventsStore.log(connectionId, "warn", {
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
        eventsStore.log(connectionId, "error", {
          type: "log-error",
          functionId: id,
          functionType: type,
          message: {
            text: message,
            args,
          },
        });
        const l = log.atWarn();
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
        log.atInfo().log(`[CON:${connectionId}]: [f:${id}][INFO]: ${message}`, ...args);
        eventsStore.log(connectionId, "info", {
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

async function trimResponse(fetchResult: Response, maxLen: number = 1000): Promise<any> {
  const text = await fetchResult.text();
  if (text.length > maxLen) {
    return `${text.substring(0, maxLen)} ... [truncated, length: ${text.length}]`;
  }
  return text;
}

function tryJson(text: string, maxLen: number = 1000): any {
  try {
    return JSON.parse(text);
  } catch (err) {
    return text;
  }
}
