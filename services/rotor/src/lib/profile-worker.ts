// Profile UDF worker — runs a profile function in an isolated Deno Web Worker.
// Receives: { type: "init", id, version, iifeCode, variables }
// Then:     { type: "exec", events, user }
// Returns:  { type: "result", result, error, logs }
// Proxies:  store/fetch/warehouse calls back to main process via postMessage

import * as functionsLib from "@jitsu/functions-lib";
import { buildEventsIterable } from "./profile-utils";

// Set globals so UDF code (compiled via functionsLibShimPlugin) can access them
for (const [name, value] of Object.entries(functionsLib)) {
  globalThis[name] = value;
}

// ── Proxy helpers (same pattern as workspace-worker.ts) ──

const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let callIdCounter = 0;

function callMain(method: string, args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const callId = String(++callIdCounter);
    pending.set(callId, { resolve, reject });
    self.postMessage({ type: "proxyRequest", callId, method, args });
  });
}

let compiledFn: any;
let funcId: string;
let funcVersion: number;
let funcProps: any;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  // Handle proxy responses from main process
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

  if (msg.type === "init") {
    funcId = msg.id;
    funcVersion = msg.version || 0;
    funcProps = msg.variables || {};
    try {
      const factory = new Function(msg.iifeCode + "\nreturn __udf;");
      const mod = factory();
      compiledFn = mod.default;
      if (typeof compiledFn !== "function") {
        throw new Error(`Profile UDF ${funcId}: default export is not a function (got ${typeof compiledFn})`);
      }
      self.postMessage({ type: "ready" });
    } catch (err: any) {
      self.postMessage({
        type: "result",
        error: { message: err.message, name: err.name || "CompilationError", stack: err.stack },
        logs: [],
      });
    }
    return;
  }

  if (msg.type === "exec") {
    const { events, user } = msg;
    const logs: any[] = [];

    try {
      const eventsIterable = buildEventsIterable(events);

      const addLogEntry = (level: string, message: string, args: any[]) => {
        logs.push({
          level,
          functionId: funcId,
          functionType: "profile",
          message,
          args: args.length > 0 ? args : undefined,
          timestamp: new Date().toISOString(),
        });
      };

      // Proxied store
      const store = {
        get: (key: string) => callMain("store.get", [key]),
        set: (key: string, obj: any, opts?: any) => callMain("store.set", [key, obj, opts]),
        del: (key: string) => callMain("store.del", [key]),
        ttl: (key: string) => callMain("store.ttl", [key]),
        getOrSet: (key: string, value: any, opts?: any) => callMain("store.getOrSet", [key, value, opts]),
        getWithTTL: (key: string) => callMain("store.getWithTTL", [key]),
      };

      // Proxied fetch
      const proxiedFetch = async (url: string, init?: any) => {
        const serialized = await callMain("fetch", [url, init]);
        return {
          status: serialized.status,
          statusText: serialized.statusText,
          ok: serialized.ok,
          url: serialized.url,
          headers: serialized.headers,
          body: serialized.body,
          text: () => Promise.resolve(serialized.body),
          json: () => Promise.resolve(JSON.parse(serialized.body)),
        };
      };

      // Proxied warehouse
      const getWarehouse = (destinationId: string) => ({
        query: (sql: string, params?: Record<string, any>) => callMain("warehouse.query", [destinationId, sql, params]),
      });

      const ctx = {
        function: { id: funcId, type: "profile", debugTill: new Date(Date.now() + 86400000) },
        props: funcProps,
        log: {
          info: (message: string, ...args: any[]) => addLogEntry("info", message, args),
          warn: (message: string, ...args: any[]) => addLogEntry("warn", message, args),
          debug: (message: string, ...args: any[]) => addLogEntry("debug", message, args),
          error: (message: string, ...args: any[]) => addLogEntry("error", message, args),
        },
        fetch: proxiedFetch,
        store,
        getWarehouse,
        profileBuilder: {
          id: funcId,
          version: funcVersion,
        },
      };

      const result = await compiledFn(eventsIterable, user, ctx);
      self.postMessage({ type: "result", result: result || undefined, logs });
    } catch (err: any) {
      self.postMessage({
        type: "result",
        error: {
          message: err.message,
          name: err.name || "Error",
          stack: err.stack,
          retryPolicy: (err as any).retryPolicy,
        },
        logs,
      });
    }
    return;
  }
};
