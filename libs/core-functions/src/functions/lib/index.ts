import {
  AnalyticsClientEvent,
  AnalyticsServerEvent,
  PageReservedProps,
  ProcessingContext,
  ServerContextReservedProps,
} from "@jitsu/protocols/analytics";
import {
  AnonymousEventsStore,
  AnyEvent,
  AnyProps,
  EventContext,
  FetchOpts,
  FetchResponse,
  FullContext,
  FuncReturn,
  FunctionLogger,
  JitsuFunction,
  Metrics,
  TTLStore,
} from "@jitsu/protocols/functions";
import { getErrorMessage, getLog, LogLevel, newError, stopwatch } from "juava";

const log = getLog("functions-context");

/**
 * Store for incoming events, destination results and function log messages
 */
export interface EventsStore {
  log(connectionId: string, level: LogLevel, msg: Record<string, any>): void;
  close(): void;
}

export const DummyEventsStore: EventsStore = {
  log(connectionId: string, level: LogLevel, msg: Record<string, any>): void {},
  close(): void {},
};

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

export type MetricsMeta = {
  workspaceId: string;
  messageId: string;
  streamId: string;
  destinationId: string;
  connectionId: string;
  functionId?: string;
  retries?: number;
};

export type FetchType = (
  url: string,
  opts?: FetchOpts,
  extra?: { log?: boolean; event?: AnyEvent }
) => Promise<FetchResponse>;

export type InternalFetchType = (
  url: string,
  opts?: FetchOpts,
  extra?: { log?: boolean; ctx?: FunctionContext; event?: AnyEvent }
) => Promise<FetchResponse>;

export type FunctionChainContext = {
  log: {
    info: (ctx: FunctionContext, message: string, ...args: any[]) => void | Promise<void>;
    warn: (ctx: FunctionContext, message: string, ...args: any[]) => void | Promise<void>;
    debug: (ctx: FunctionContext, message: string, ...args: any[]) => void | Promise<void>;
    error: (ctx: FunctionContext, message: string, ...args: any[]) => void | Promise<void>;
  };
  fetch: InternalFetchType;
  store: TTLStore;
  anonymousEventsStore?: AnonymousEventsStore;
  metrics?: Metrics;
  connectionOptions?: any;
};

export function wrapperFunction<E extends AnyEvent = AnyEvent, P extends AnyProps = AnyProps>(
  chainCtx: FunctionChainContext,
  funcCtx: FunctionContext<P>,
  jitsuFunction: JitsuFunction<E, P>
): JitsuFunctionWrapper<E> {
  const log = createFunctionLogger(chainCtx, funcCtx);
  const fetchWithLog = createFetchWrapper(chainCtx, funcCtx);
  const props = funcCtx.props;
  const store = chainCtx.store;

  return async (event: E, ctx: EventContext) => {
    let ftch = chainCtx.fetch;
    const fetchLogEnabled =
      chainCtx.connectionOptions?.fetchLogLevel !== "debug" ||
      (funcCtx.function.debugTill && funcCtx.function.debugTill > new Date());
    if (fetchLogEnabled) {
      ftch = async (url, opts, extra) => {
        return fetchWithLog(url, opts, { ...extra, event });
      };
    }
    const fullContext: FullContext<P> = {
      ...ctx,
      log,
      fetch: ftch,
      store,
      props,
    };
    fullContext["anonymousEventsStore"] = chainCtx.anonymousEventsStore;
    fullContext["connectionOptions"] = chainCtx.connectionOptions;
    return jitsuFunction(event, fullContext);
  };
}

function createFunctionLogger(chainCtx: FunctionChainContext, funcCtx: FunctionContext): FunctionLogger {
  return {
    info: (message: string, ...args: any) => chainCtx.log.info(funcCtx, message, ...args),
    warn: (message: string, ...args: any) => chainCtx.log.warn(funcCtx, message, ...args),
    debug: (message: string, ...args: any) => chainCtx.log.debug(funcCtx, message, ...args),
    error: (message: string, ...args: any) => chainCtx.log.error(funcCtx, message, ...args),
  };
}

function createFetchWrapper(chainCtx: FunctionChainContext, funcCtx: FunctionContext): FetchType {
  return (url: string, opts?: FetchOpts, debug?: { event?: AnyEvent; log?: boolean }) => {
    return chainCtx.fetch(url, opts, { log: debug?.log, ctx: funcCtx, event: debug?.event });
  };
}

export type FunctionContext<P extends AnyProps = AnyProps> = {
  function: {
    id: string;
    type: string;
    debugTill?: Date;
  };
  props: P;
};

export type JitsuFunctionWrapper<E extends AnyEvent = AnyEvent> = (
  event: E,
  ctx: EventContext
) => Promise<FuncReturn> | FuncReturn;

type KnownEventKeys = keyof Required<AnalyticsClientEvent & ServerContextReservedProps & ProcessingContext>;
//to make sure we
const knownProps: Record<keyof Required<AnalyticsClientEvent & ServerContextReservedProps & ProcessingContext>, true> =
  {
    $table: true,
    anonymousId: true,
    category: true,
    context: true,
    event: true,
    groupId: true,
    messageId: true,
    name: true,
    previousId: true,
    properties: true,
    receivedAt: true,
    requestIp: true,
    sentAt: true,
    timestamp: true,
    traits: true,
    type: true,
    userId: true,
    writeKey: true,
  };

const knownPageProps: Record<keyof Required<PageReservedProps>, true> = {
  path: true,
  host: true,
  referrer: true,
  referring_domain: true,
  search: true,
  title: true,
  url: true,
};

export function getEventCustomProperties(
  event: AnalyticsServerEvent,
  opts?: { exclude?: (obj: Record<string, any>) => void }
) {
  const res: Record<string, any> = {};
  for (const prop in event) {
    if (!knownProps[prop]) {
      res[prop] = event[prop];
    }
  }
  for (const prop in event.context.page || {}) {
    if (!knownPageProps[prop]) {
      res[prop] = event[prop];
    }
  }
  const props = { ...res, ...(event.properties || {}), ...(event.context || {}) };
  if (opts?.exclude) {
    opts.exclude(props);
  }
  return props;
}

export function getTraits(event: AnalyticsServerEvent) {
  return { ...(event.traits || {}), ...(event.context?.traits || {}) };
}

export function createFilter(filter: string): (eventType: string, eventName?: string) => boolean {
  if (filter === "*") {
    return () => true;
  } else if (filter === "") {
    return eventType => eventType !== "page" && eventType !== "screen";
  } else {
    const events = filter.split(",").map(e => e.trim());
    return (eventType: string, eventName?: string) => {
      return events.includes(eventType) || (!!eventName && events.includes(eventName));
    };
  }
}

export function eventTimeSafeMs(event: AnalyticsServerEvent) {
  const now = new Date().getTime();
  const ts = event.timestamp ? new Date(event.timestamp as string).getTime() : NaN;
  const receivedAt = event.receivedAt ? new Date(event.receivedAt as string).getTime() : NaN;
  return Math.min(!isNaN(ts) ? ts : now, !isNaN(receivedAt) ? receivedAt : now, now);
}

export const makeLog = (connectionId: string, eventsStore: EventsStore) => ({
  debug: (ctx: FunctionContext, message: any, ...args: any[]) => {
    if (ctx.function.debugTill && ctx.function.debugTill > new Date()) {
      const fid = ctx.function.id;
      log.atDebug().log(`[CON:${connectionId}]: [f:${fid}][DEBUG]: ${message}`, ...args);
      eventsStore.log(connectionId, "debug", {
        type: "log-debug",
        functionId: fid,
        functionType: ctx.function.type,
        message: {
          text: message,
          args,
        },
      });
    }
  },
  warn: (ctx: FunctionContext, message: any, ...args: any[]) => {
    const fid = ctx.function.id;
    log.atWarn().log(`[CON:${connectionId}]: [f:${fid}][WARN]: ${message}`, ...args);
    eventsStore.log(connectionId, "warn", {
      type: "log-warn",
      functionId: fid,
      functionType: ctx.function.type,
      message: {
        text: message,
        args,
      },
    });
  },
  error: (ctx: FunctionContext, message: any, ...args: any[]) => {
    const fid = ctx.function.id;
    eventsStore.log(connectionId, "error", {
      type: "log-error",
      functionId: fid,
      functionType: ctx.function.type,
      message: {
        text: message,
        args,
      },
    });
    const l = log.atError();
    if (args?.length > 0) {
      const last = args[args.length - 1];
      if (last.stack) {
        l.withCause(last);
        args = args.slice(0, args.length - 1);
      }
    }
    l.log(`[CON:${connectionId}]: [f:${fid}][ERROR]: ${message}`, ...args);
  },
  info: (ctx: FunctionContext, message: any, ...args: any[]) => {
    const fid = ctx.function.id;
    log.atInfo().log(`[CON:${connectionId}]: [f:${fid}][INFO]: ${message}`, ...args);
    eventsStore.log(connectionId, "info", {
      type: "log-info",
      functionId: fid,
      functionType: ctx.function.type,
      message: {
        text: message,
        args,
      },
    });
  },
});

export const makeFetch =
  (connectionId: string, eventsStore: EventsStore, logLevel: "info" | "debug", fetchTimeoutMs: number = 5000) =>
  async (
    url: string,
    init?: FetchOpts,
    extra?: { log?: boolean; ctx?: FunctionContext; event?: AnyEvent }
  ): Promise<Response> => {
    //capture execution time
    const sw = stopwatch();
    const ctx = extra?.ctx?.function;
    const id = ctx?.id || "unknown";
    const type = ctx?.type || "unknown";
    const logEnabled = logLevel === "info" || (ctx?.debugTill && ctx?.debugTill > new Date());
    const logToRedis = typeof extra?.log === "boolean" ? extra.log : true;
    const baseInfo =
      logEnabled && logToRedis
        ? {
            functionId: id,
            functionType: type,
            type: "http-request",
            url: url,
            method: init?.method || "GET",
            body: init?.body,
            headers: init?.headers ? hideSensitiveHeaders(init.headers) : undefined,
            event: extra?.event || {},
          }
        : undefined;

    let internalInit: RequestInit = {
      ...init,
      keepalive: true,
      signal: AbortSignal.timeout(fetchTimeoutMs),
    };
    let fetchResult: any = undefined;
    try {
      fetchResult = await fetch(url, internalInit);
    } catch (err: any) {
      if (err.name === "TimeoutError") {
        err = newError(`Fetch request exceeded timeout ${fetchTimeoutMs}ms and was aborted`, err);
      }
      if (logEnabled) {
        const elapsedMs = sw.elapsedMs();
        if (logToRedis) {
          eventsStore.log(connectionId, logLevel, { ...baseInfo, error: getErrorMessage(err), elapsedMs: elapsedMs });
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

    if (logEnabled) {
      const elapsedMs = sw.elapsedMs();
      //clone response to be able to read it twice
      const cloned = fetchResult.clone();
      const respText = await trimResponse(cloned);
      if (logToRedis) {
        eventsStore.log(connectionId, logLevel, {
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
  };

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
