import { parentPort } from "worker_threads";

if (!parentPort) {
  throw new Error("udf-worker must be run as a worker thread");
}

// Pending proxy requests awaiting response from main thread
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let requestIdCounter = 0;

function nextId(): string {
  return String(++requestIdCounter);
}

// Send a proxy request to the main thread and await the response
function callMain(type: string, args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId();
    pending.set(id, { resolve, reject });
    parentPort!.postMessage({ type, id, args });
  });
}

function deepCopy<T>(o: T): T {
  if (typeof o !== "object") {
    return o;
  }
  if (!o) {
    return o;
  }

  if (Array.isArray(o)) {
    const newO: any[] = [];
    for (let i = 0; i < o.length; i += 1) {
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

// Handle response messages from main thread
parentPort.on("message", async (msg: any) => {
  if (msg.type === "response") {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    }
    return;
  }

  if (msg.type === "init") {
    const { compiledCodePath, event, eventContext, variables, workspaceId } = msg;

    // Build proxied store
    const store = {
      get: (key: string) => callMain("store.get", [key]),
      set: (key: string, obj: any, opts?: any) => callMain("store.set", [key, obj, opts]),
      del: (key: string) => callMain("store.del", [key]),
      ttl: (key: string) => callMain("store.ttl", [key]),
      getOrSet: (key: string, value: any, opts?: any) => callMain("store.getOrSet", [key, value, opts]),
      getWithTTL: (key: string) => callMain("store.getWithTTL", [key]),
    };

    // Build proxied logger (fire-and-forget — no response needed)
    const log = {
      info: (message: string, ...args: any[]) => {
        parentPort!.postMessage({ type: "log", level: "info", message, args, timestamp: new Date().toISOString() });
      },
      warn: (message: string, ...args: any[]) => {
        parentPort!.postMessage({ type: "log", level: "warn", message, args, timestamp: new Date().toISOString() });
      },
      debug: (message: string, ...args: any[]) => {
        parentPort!.postMessage({ type: "log", level: "debug", message, args, timestamp: new Date().toISOString() });
      },
      error: (message: string, ...args: any[]) => {
        parentPort!.postMessage({ type: "log", level: "error", message, args, timestamp: new Date().toISOString() });
      },
    };

    // Build proxied fetch
    const proxiedFetch = async (url: string, init?: any) => {
      const serialized = await callMain("fetch", [url, init]);
      // Reconstruct a Response-like object from the serialized data
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
    };

    // Build proxied warehouse
    const getWarehouse = (destinationId: string) => ({
      query: (sql: string, params?: Record<string, any>) => callMain("warehouse.query", [destinationId, sql, params]),
    });

    // Build full context
    const ctx = {
      ...eventContext,
      log,
      fetch: proxiedFetch,
      store,
      props: variables || {},
      retries: 0,
      getWarehouse,
    };

    let module: any;
    try {
      // Dynamic import of the compiled .mjs UDF file
      module = await import(compiledCodePath);
      const func = module.default;
      if (typeof func !== "function") {
        parentPort!.postMessage({
          type: "result",
          error: { message: `Default export is not a function: ${typeof func}`, name: "CompilationError" },
        });
        return;
      }

      const result = await func(deepCopy(event), ctx);

      // Check for "drop" result
      const dropped = isDropResult(result);
      parentPort!.postMessage({
        type: "result",
        result: typeof result === "undefined" ? event : result,
        dropped,
      });
    } catch (e: any) {
      parentPort!.postMessage({
        type: "result",
        error: {
          message: e.message || String(e),
          name: e.name || "Error",
          stack: e.stack,
          retryPolicy: module.config?.retryPolicy,
        },
      });
    }
  }
});
