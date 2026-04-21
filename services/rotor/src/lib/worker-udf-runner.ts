// ── /udfrun: run a single UDF in a temporary Deno Web Worker ──
import { EventContext, TTLStore } from "@jitsu/protocols/functions";
import { EnrichedConnectionConfig, EntityStore, makeFetch, parseUserAgent } from "@jitsu/core-functions-lib";
import { LogLevel, parseNumber } from "juava";
import { compileUdfToIIFE } from "./udf-shared";
import type { ExecMessage, InitMessage, ProxyResponseMessage, WorkerConnectionInit } from "./worker-protocol";
import { warehouseQuery } from "./warehouse-store";
import { getServerEnv } from "../serverEnv";

const env = getServerEnv();

function getWorkerUrl(): string {
  return new URL("./workspace-worker.mjs", import.meta.url).href;
}

export async function runUdfInWorker(
  request: any,
  store: TTLStore,
  conEntityStore: EntityStore<EnrichedConnectionConfig>
): Promise<any> {
  const udfTimeoutMs = parseNumber(env.UDF_TIMEOUT_MS, 5000);
  const dumpStore = () => (typeof (store as any).dump === "function" ? (store as any).dump() : {});

  try {
    const iifeCode = await compileUdfToIIFE(request.code, request.functionId, request.variables);

    const eventContext: EventContext = {
      receivedAt: new Date(),
      geo: {
        country: { code: "US", name: "United States", isEU: false },
        city: { name: "New York" },
        region: { code: "NY", name: "New York" },
        location: { latitude: 40.6808, longitude: -73.9701 },
        postalCode: { code: "11238" },
      },
      ua: parseUserAgent(
        request.event?.context?.userAgent ||
          request.userAgent ||
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
      ),
      headers: {
        host: "example.com",
        "user-agent":
          request.event?.context?.userAgent ||
          request.userAgent ||
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "accept-encoding": "gzip, deflate, br",
        connection: "keep-alive",
        referer: "https://example.com/",
        origin: "https://example.com",
      },
      source: {
        id: "functionsDebugger-streamId",
        name: "Functions Debugger Stream",
        type: "browser",
      },
      destination: {
        id: "functionsDebugger-destinationId",
        type: "clickhouse",
        updatedAt: new Date(),
        hash: "hash",
      },
      connection: {
        id: "functionsDebugger",
      },
      workspace: {
        id: request.workspaceId,
      },
    };

    const connectionInit: WorkerConnectionInit = {
      connectionId: "udfrun",
      connection: {
        id: "udfrun",
        workspaceId: request.workspaceId,
        streamId: "udfrun-stream",
        streamName: "UDF Runner",
        destinationId: "udfrun-dest",
        type: "clickhouse",
        updatedAt: new Date(),
        usesBulker: false,
        metricsKeyPrefix: "udfrun",
        options: {},
        optionsHash: "",
      },
      functions: [{ id: `udf.${request.functionId}`, iifeCode }],
      functionsClass: env.FUNCTIONS_CLASS,
      warehouseEnabled: true,
      // /udfrun is a manual debugger invocation — always enable debug logs
      debugTill: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      props: request.variables || {},
    };

    const worker = new Worker(getWorkerUrl(), {
      type: "module",
      // @ts-ignore Deno-specific
      deno: { permissions: "none" },
    });

    const fetchImpl = makeFetch(
      "functionsDebugger",
      {
        log(connectionId: string, level: LogLevel, msg: Record<string, any>) {},
        close() {},
        deadLetter() {},
      },
      "info"
    );

    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({
          error: { message: `Function execution timed out after ${udfTimeoutMs}ms`, name: "TimeoutError" },
          result: {},
          store: dumpStore(),
          logs: [],
        });
      }, udfTimeoutMs);

      worker.onmessage = async (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === "ready") {
          worker.postMessage({
            type: "exec",
            requestId: "udfrun-1",
            connectionId: "udfrun",
            event: request.event,
            eventContext: JSON.parse(JSON.stringify(eventContext)),
            fetchTimeoutMs: parseNumber(env.FETCH_TIMEOUT_MS, 2000),
          } as ExecMessage);
          return;
        }

        if (msg.type === "log") {
          // logs.push({
          //   message: msg.message + (Array.isArray(msg.args) && msg.args.length > 0 ? `, ${msg.args.join(",")}` : ""),
          //   level: msg.level,
          //   timestamp: new Date(msg.timestamp),
          //   type: "log",
          // });
          // return;
        }

        if (msg.type === "result") {
          clearTimeout(timer);
          worker.terminate();
          const hasError = msg.execLog?.some((e: any) => e.error);
          if (hasError) {
            const err = msg.execLog.find((e: any) => e.error)?.error;
            resolve({
              error: { message: err.message, stack: err.stack, name: err.name, retryPolicy: err.retryPolicy },
              result: {},
              store: dumpStore(),
              logs: msg.logs,
            });
          } else {
            const dropped = msg.events.length === 0;
            resolve({
              dropped,
              result: dropped ? {} : msg.events.length === 1 ? msg.events[0] : msg.events,
              store: dumpStore(),
              logs: msg.logs,
            });
          }
          return;
        }

        if (msg.type === "proxyRequest") {
          const { callId, method, args } = msg;
          try {
            let result: any;
            if (method.startsWith("store.")) {
              const op = method.split(".")[1];
              result = await (store as any)[op](...args);
            } else if (method === "fetch") {
              // Worker sends [connectionId, url, init] — connectionId is unused here (single-connection runner)
              const [, url, init] = args;
              const res = await fetchImpl(url, init);
              const responseHeaders: Record<string, string> = {};
              res.headers.forEach((v: string, k: string) => {
                responseHeaders[k] = v;
              });
              result = {
                status: res.status,
                statusText: res.statusText,
                ok: res.ok,
                url: res.url,
                type: res.type,
                redirected: res.redirected,
                headers: responseHeaders,
                body: await res.text(),
              };
            } else if (method === "warehouse.query") {
              const [destinationId, sql, params] = args;
              result = await warehouseQuery(request.workspaceId, conEntityStore, destinationId, sql, params);
            }
            worker.postMessage({ type: "proxyResponse", callId, result } as ProxyResponseMessage);
          } catch (err: any) {
            worker.postMessage({ type: "proxyResponse", callId, error: err.message } as ProxyResponseMessage);
          }
          return;
        }
      };

      worker.onerror = (err: ErrorEvent) => {
        clearTimeout(timer);
        resolve({
          error: { message: err.message, name: "WorkerError" },
          result: {},
          store: dumpStore(),
          logs: [],
        });
      };

      worker.postMessage({ type: "init", connections: [connectionInit] } as InitMessage);
    });

    return result;
  } catch (e: any) {
    if (e.errors && Array.isArray(e.errors)) {
      const errorMessages = e.errors.map((err: any) => err.text).join("\n");
      return {
        error: {
          message: `Failed to compile function ${request.functionId}:\n${errorMessages}`,
          name: "CompilationError",
        },
        result: {},
        store: dumpStore(),
        logs: [],
      };
    }
    return {
      error: { message: e.message, name: e.name || "Error", stack: e.stack },
      result: {},
      store: dumpStore(),
      logs: [],
    };
  }
}
