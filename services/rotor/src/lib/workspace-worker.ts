// Deno Web Worker script – runs with permissions: "none".
// All I/O (store, fetch, warehouse) is proxied to the main process via postMessage.
//
// Used for:
//   1. Long-lived per-workspace workers (free tier)
//   2. Temporary workers for /udfrun endpoint

import type {
  MainToWorkerMessage,
  MemoryResponseMessage,
  WorkerFunctionInit,
  ResultMessage,
  SerializedLogEntry,
  ProxyMethod,
  StrippedConnectionConfig,
} from "./worker-protocol";
import type { AnyEvent, EventContext, FuncReturn, FullContext } from "@jitsu/protocols/functions";
import type { FunctionExecLog, FunctionExecRes } from "@jitsu/core-functions-lib";

import * as functionsLib from "@jitsu/functions-lib";

// Set globals so UDF code (compiled via functionsLibShimPlugin) can access them
for (const [name, value] of Object.entries(functionsLib)) {
  globalThis[name] = value;
}

// ── Proxy helpers ───────────────────────────────────────────────────

const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let callIdCounter = 0;

function nextCallId(): string {
  return String(++callIdCounter);
}

function callMain(method: ProxyMethod, args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const callId = nextCallId();
    pending.set(callId, { resolve, reject });
    self.postMessage({ type: "proxyRequest", callId, method, args });
  });
}

// ── Deep copy (same as chain-runner, inlined to avoid import issues in sandbox) ──

function deepCopy<T>(o: T): T {
  if (typeof o !== "object") return o;
  if (!o) return o;
  if (Array.isArray(o)) {
    const newO: any[] = [];
    for (let i = 0; i < o.length; i++) {
      const v = o[i];
      newO[i] = !v || typeof v !== "object" ? v : deepCopy(v);
    }
    return newO as T;
  }
  const newO: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) {
    newO[k] = !v || typeof v !== "object" ? v : deepCopy(v);
  }
  return newO as T;
}

function isDropResult(result: any): boolean {
  return result === "drop" || (Array.isArray(result) && result.length === 0) || result === null || result === false;
}

// ── Loaded function type ────────────────────────────────────────────

type LoadedFunc = {
  id: string;
  exec: (event: AnyEvent, ctx: FullContext) => Promise<FuncReturn>;
  config?: any;
};

type ConnectionChain = {
  connection: StrippedConnectionConfig;
  functions: LoadedFunc[];
  props: Record<string, any>;
  debugTill?: string;
  fetchLogLevel?: string;
  warehouseEnabled: boolean;
  functionsClass: string;
};

const chains = new Map<string, ConnectionChain>();

// ── UDF instantiation from IIFE code ────────────────────────────────

function instantiateUdf(funcInit: WorkerFunctionInit): LoadedFunc {
  // The IIFE code defines `var __udf = (()=>{ ... })();`
  // We wrap it in a Function that returns __udf.
  const factory = new Function(funcInit.iifeCode + "\nreturn __udf;");
  const mod = factory();
  const func = mod.default;
  if (typeof func !== "function") {
    throw new Error(`UDF ${funcInit.id}: default export is not a function (got ${typeof func})`);
  }
  return {
    id: funcInit.id,
    exec: func,
    config: mod.config,
  };
}

// ── Build proxied context ───────────────────────────────────────────

function buildContext(
  chain: ConnectionChain,
  eventContext: EventContext,
  functionId: string,
  functionType: string,
  logs: SerializedLogEntry[]
): FullContext {
  const debugTill = chain.debugTill ? new Date(chain.debugTill) : undefined;

  // Proxied store
  const store = {
    get: (key: string) => callMain("store.get", [key]),
    set: (key: string, obj: any, opts?: any) => callMain("store.set", [key, obj, opts]),
    del: (key: string) => callMain("store.del", [key]),
    ttl: (key: string) => callMain("store.ttl", [key]),
    getOrSet: (key: string, value: any, opts?: any) => callMain("store.getOrSet", [key, value, opts]),
    getWithTTL: (key: string) => callMain("store.getWithTTL", [key]),
  };

  // Collecting logger (fire-and-forget via postMessage)
  const addLogEntry = (level: SerializedLogEntry["level"], message: string, args: any[]) => {
    if (level === "debug" && !(debugTill && debugTill.getTime() > Date.now())) {
      return;
    }
    const entry: SerializedLogEntry = {
      level,
      functionId,
      functionType,
      message,
      args: args.length > 0 ? args : undefined,
      timestamp: new Date().toISOString(),
    };
    logs.push(entry);
    //self.postMessage({ type: "log", ...entry });
  };

  const log = {
    info: (message: string, ...args: any[]) => addLogEntry("info", message, args),
    warn: (message: string, ...args: any[]) => addLogEntry("warn", message, args),
    debug: (message: string, ...args: any[]) => addLogEntry("debug", message, args),
    error: (message: string, ...args: any[]) => addLogEntry("error", message, args),
  };

  // Proxied fetch – delegates to main process, logs request/response like makeFetch
  const proxiedFetch = async (url: string, init?: any) => {
    const startTime = Date.now();

    const baseInfo = {
      functionId,
      functionType,
      type: "http-request" as const,
      url,
      method: init?.method || "GET",
      body: init?.body,
      event: {},
    };

    try {
      const serialized = await callMain("fetch", [chain.connection.id, url, init]);
      const elapsedMs = Date.now() - startTime;

      if (baseInfo) {
        logs.push({
          level: "info",
          functionId,
          functionType,
          message: {
            ...baseInfo,
            status: serialized.status,
            statusText: serialized.statusText,
            elapsedMs,
          },
          timestamp: new Date().toISOString(),
        });
      }

      return {
        status: serialized.status,
        statusText: serialized.statusText,
        ok: serialized.ok,
        url: serialized.url,
        type: serialized.type,
        redirected: serialized.redirected,
        headers: serialized.headers,
        bodyUsed: true,
        body: serialized.body,
        text: () => Promise.resolve(serialized.body),
        json: () => Promise.resolve(JSON.parse(serialized.body)),
      };
    } catch (err: any) {
      const elapsedMs = Date.now() - startTime;
      if (baseInfo) {
        logs.push({
          level: "error",
          functionId,
          functionType,
          message: {
            ...baseInfo,
            error: err.message || String(err),
            elapsedMs,
          },
          timestamp: new Date().toISOString(),
        });
      }
      throw err;
    }
  };

  // Proxied warehouse
  const getWarehouse = (destinationId: string) => ({
    query: (sql: string, params?: Record<string, any>) => {
      if (!chain.warehouseEnabled) {
        return Promise.reject(
          new Error("Warehouse queries are not available on the free plan. Please upgrade to use this feature.")
        );
      }
      if (chain.functionsClass === "free") {
        logs.push({
          level: "warn",
          functionId,
          functionType,
          message: `Warehouse queries can always be run in the Functions Debugger. However, running this feature in production requires a paid subscription.`,
          timestamp: new Date().toISOString(),
        });
      }
      return callMain("warehouse.query", [destinationId, sql, params]);
    },
  });

  const retries = (eventContext as EventContext & { retries?: number }).retries ?? 0;

  return {
    ...eventContext,
    log,
    fetch: proxiedFetch as any,
    store,
    props: chain.props,
    retries,
    getWarehouse,
  };
}

// ── Chain execution (inline – mirrors chain-runner.ts logic) ────────

async function runChainInWorker(
  chain: ConnectionChain,
  event: AnyEvent,
  eventContext: EventContext,
  fetchTimeoutMs: number
): Promise<{ events: AnyEvent[]; execLog: FunctionExecLog; logs: SerializedLogEntry[] }> {
  const execLog: FunctionExecLog = [];
  const logs: SerializedLogEntry[] = [];
  let events: AnyEvent[] = [event];

  for (let k = 0; k < chain.functions.length; k++) {
    const func = chain.functions[k];
    const newEvents: AnyEvent[] = [];

    for (let i = 0; i < events.length; i++) {
      const currentEvent = events[i];
      const startMs = Date.now();
      let result: FuncReturn = undefined;

      const ar = func.id.split(".");
      const id = ar.pop() as string;
      const functionType = ar.join(".");
      const execLogEntry: Partial<FunctionExecRes> & { functionType?: string } = {
        eventIndex: i,
        receivedAt: eventContext.receivedAt,
        functionId: id,
        functionType,
      };

      try {
        const ctx = buildContext(chain, eventContext, id, functionType, logs);
        result = await func.exec(deepCopy(currentEvent), ctx);

        if (k < chain.functions.length - 1 && Array.isArray(result) && result.length > 1) {
          const l = result.length;
          result = undefined;
          const err = new Error(
            `Got ${l} events as result of function #${k + 1} of ${
              chain.functions.length
            }. Only the last function in a chain is allowed to multiply events.`
          );
          err.name = functionsLib.NoRetryErrorName;
          throw err;
        }
      } catch (err: any) {
        if (err?.name === functionsLib.DropRetryErrorName || err?.name === functionsLib.NoRetryErrorName) {
          result = "drop";
        }
        if (func?.config?.retryPolicy) {
          err.retryPolicy = func.config.retryPolicy;
        }
        execLogEntry.error = {
          name: err.name,
          message: err.message,
          stack: err.stack,
          retryPolicy: err.retryPolicy,
          functionId: id,
        };
      }

      execLogEntry.ms = Date.now() - startMs;
      execLogEntry.dropped = isDropResult(result);
      execLog.push(execLogEntry as FunctionExecRes);

      if (!isDropResult(result)) {
        if (result) {
          if (Array.isArray(result)) {
            newEvents.push(...result);
          } else {
            newEvents.push(result as AnyEvent);
          }
        } else {
          newEvents.push(currentEvent);
        }
      }
    }

    events = newEvents;
    if (events.length === 0) break;
  }

  return { events, execLog, logs };
}

// ── Message handler ─────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data;

  // Handle proxy responses
  if (msg.type === "proxyResponse") {
    const p = pending.get(msg.callId);
    if (p) {
      pending.delete(msg.callId);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    }
    return;
  }

  // Handle memory query
  if (msg.type === "memoryQuery") {
    let heapUsedBytes = 0;
    let heapTotalBytes = 0;
    try {
      // process.memoryUsage() is available via Deno's Node compat layer
      const mem = process.memoryUsage();
      heapUsedBytes = mem.heapUsed;
      heapTotalBytes = mem.heapTotal;
    } catch (_) {
      // permissions: "none" may block this — report 0
    }
    const resp: MemoryResponseMessage = { type: "memoryResponse", heapUsedBytes, heapTotalBytes };
    self.postMessage(resp);
    return;
  }

  // Handle init
  if (msg.type === "init") {
    // Pre-import Node built-ins so UDF require() calls work
    // await preloadNodeBuiltins();

    for (const conn of msg.connections) {
      const funcs: LoadedFunc[] = [];
      for (const funcInit of conn.functions) {
        try {
          funcs.push(instantiateUdf(funcInit));
        } catch (err: any) {
          // Create error-throwing placeholder
          const errorMessage = err.message;
          funcs.push({
            id: funcInit.id,
            exec: async () => {
              throw new Error(errorMessage);
            },
          });
        }
      }
      chains.set(conn.connectionId, {
        connection: conn.connection,
        functions: funcs,
        props: conn.props,
        debugTill: conn.debugTill,
        fetchLogLevel: conn.fetchLogLevel,
        warehouseEnabled: conn.warehouseEnabled,
        functionsClass: conn.functionsClass,
      });
    }
    self.postMessage({ type: "ready" });
    return;
  }

  // Handle exec
  if (msg.type === "exec") {
    const chain = chains.get(msg.connectionId);
    if (!chain) {
      const result: ResultMessage = {
        type: "result",
        requestId: msg.requestId,
        connectionId: msg.connectionId,
        events: [],
        execLog: [
          {
            error: { message: `Connection '${msg.connectionId}' not found in worker`, name: "NoRetryError" },
            ms: 0,
            eventIndex: 0,
            functionId: "",
          } as any,
        ],
        logs: [],
      };
      self.postMessage(result);
      return;
    }

    // Parse dates back from serialization
    if (msg.eventContext?.receivedAt && typeof msg.eventContext.receivedAt === "string") {
      msg.eventContext.receivedAt = new Date(msg.eventContext.receivedAt);
    }
    if (msg.eventContext?.destination?.updatedAt && typeof msg.eventContext.destination.updatedAt === "string") {
      msg.eventContext.destination.updatedAt = new Date(msg.eventContext.destination.updatedAt);
    }

    try {
      const { events, execLog, logs } = await runChainInWorker(chain, msg.event, msg.eventContext, msg.fetchTimeoutMs);
      const result: ResultMessage = {
        type: "result",
        requestId: msg.requestId,
        connectionId: msg.connectionId,
        events,
        execLog,
        logs,
      };
      self.postMessage(result);
    } catch (err: any) {
      const result: ResultMessage = {
        type: "result",
        requestId: msg.requestId,
        connectionId: msg.connectionId,
        events: [],
        execLog: [
          {
            error: { message: err.message, name: err.name || "Error" },
            ms: 0,
            eventIndex: 0,
            functionId: "",
          } as any,
        ],
        logs: [],
      };
      self.postMessage(result);
    }
    return;
  }
};
