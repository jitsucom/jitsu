import { Worker } from "worker_threads";
import path from "path";
import fsp from "fs/promises";
import { getLog, LogLevel, parseNumber, stopwatch } from "juava";
import { makeFetch, isDropResult, EntityStore, EnrichedConnectionConfig, logType } from "@jitsu/core-functions-lib";
import { EventContext, TTLStore } from "@jitsu/protocols/functions";
import { parseUserAgent } from "@jitsu/core-functions-lib";
import { warehouseQuery } from "./warehouse-store";
import { compileUdfToFile } from "./udf-shared";
import { getServerEnv } from "../serverEnv";
import { randomUUID } from "node:crypto";

const log = getLog("udf-worker-runner");
const serverEnv = getServerEnv();

export type UDFTestRequest = {
  functionId: string;
  functionName: string;
  code: string;
  event: any;
  variables: any;
  workspaceId: string;
  userAgent?: string;
};

export type UDFTestResponse = {
  error?: {
    message: string;
    stack?: string;
    name: string;
    retryPolicy?: any;
  };
  dropped?: boolean;
  result: any;
  store: any;
  logs: logType[];
  backend?: "functions-server" | "rotor";
};

// Resolve the worker script path.
// In production (built), the worker is at dist/udf-worker.js alongside the main bundle.
// During development (tsx), use the .ts source directly.
function getWorkerPath(): string {
  // Check if we're running from dist/ (production build)
  const distWorker = path.join(__dirname, "udf-worker.js");
  try {
    require.resolve(distWorker);
    return distWorker;
  } catch {
    // Fallback: dev mode — use the TS source via tsx
    return path.join(__dirname, "udf-worker.ts");
  }
}

export async function runUdfInWorker(
  request: UDFTestRequest,
  store: TTLStore,
  conEntityStore?: EntityStore<EnrichedConnectionConfig>
): Promise<UDFTestResponse> {
  const logs: logType[] = [];
  const udfTimeoutMs = parseNumber(serverEnv.UDF_TIMEOUT_MS, 5000);
  const dumpStore = () => (typeof (store as any).dump === "function" ? (store as any).dump() : {});
  let compiledCodePath: string | undefined;
  let worker: Worker | undefined;

  try {
    // 1. Compile using shared compilation utility
    compiledCodePath = await compileUdfToFile(randomUUID(), request.code, request.functionId, request.variables);
    // 3. Create fetch with minimal eventsStore that collects fetch logs
    const fetchImpl = makeFetch(
      "functionsDebugger",
      {
        log(connectionId: string, level: LogLevel, msg: Record<string, any>) {
          let statusText;
          if (msg.error) {
            statusText = `${msg.error}`;
          } else {
            statusText = `${msg.statusText ?? ""}${msg.status ? `(${msg.status})` : ""}`;
          }
          logs.push({
            message: `${msg.method} ${msg.url} :: ${statusText}`,
            level: msg.error ? "error" : "debug",
            timestamp: new Date(),
            type: "http",
          });
        },
        close() {},
        deadLetter() {},
      },
      "info"
    );

    // 4. Build eventContext
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
    // 5. Spawn Worker
    const workerPath = getWorkerPath();
    worker = new Worker(workerPath);

    // 6. Execute with timeout
    const result = await new Promise<UDFTestResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker?.terminate();
        resolve({
          error: {
            message: `Function execution timed out after ${udfTimeoutMs}ms`,
            name: "TimeoutError",
          },
          result: {},
          store: dumpStore(),
          logs,
        });
      }, udfTimeoutMs);

      worker!.on("message", async (msg: any) => {
        try {
          if (msg.type === "inited") {
          }
          if (msg.type === "log") {
            logs.push({
              message: msg.message + (Array.isArray(msg.args) && msg.args.length > 0 ? `, ${msg.args.join(",")}` : ""),
              level: msg.level,
              timestamp: new Date(msg.timestamp),
              type: "log",
            });
            return;
          }

          if (msg.type === "result") {
            clearTimeout(timer);
            if (msg.error) {
              resolve({
                error: {
                  message: msg.error.message,
                  stack: msg.error.stack,
                  name: msg.error.name,
                  retryPolicy: msg.error.retryPolicy,
                },
                result: {},
                store: dumpStore(),
                logs,
              });
            } else {
              resolve({
                dropped: isDropResult(msg.result),
                result: msg.result,
                store: dumpStore(),
                logs,
              });
            }
            return;
          }

          // Proxy requests from worker
          if (msg.type.startsWith("store.")) {
            const op = msg.type.split(".")[1]; // get, set, del, ttl, getOrSet, getWithTTL
            try {
              const result = await (store as any)[op](...msg.args);
              worker!.postMessage({ type: "response", id: msg.id, result });
            } catch (e: any) {
              worker!.postMessage({ type: "response", id: msg.id, error: e.message });
            }
            return;
          }

          if (msg.type === "fetch") {
            try {
              const [url, init] = msg.args;
              const res = await fetchImpl(url, init);
              const headers: Record<string, string> = {};
              res.headers.forEach((v: string, k: string) => {
                headers[k] = v;
              });
              const text = await res.text();
              worker!.postMessage({
                type: "response",
                id: msg.id,
                result: {
                  status: res.status,
                  statusText: res.statusText,
                  ok: res.ok,
                  url: res.url,
                  type: res.type,
                  redirected: res.redirected,
                  headers,
                  body: text,
                },
              });
            } catch (e: any) {
              worker!.postMessage({ type: "response", id: msg.id, error: e.message });
            }
            return;
          }

          if (msg.type === "warehouse.query") {
            try {
              const [destinationId, sql, params] = msg.args;
              if (!conEntityStore) {
                throw new Error("Connection store is not provided");
              }
              const result = await warehouseQuery(request.workspaceId, conEntityStore, destinationId, sql, params);
              worker!.postMessage({ type: "response", id: msg.id, result });
            } catch (e: any) {
              worker!.postMessage({ type: "response", id: msg.id, error: e.message });
            }
            return;
          }
        } catch (e: any) {
          log.atError().log(`Error handling worker message: ${e.message}`);
        }
      });

      worker!.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({
          error: { message: err.message, name: err.name, stack: err.stack },
          result: {},
          store: dumpStore(),
          logs,
        });
      });

      worker!.on("exit", (code: number) => {
        clearTimeout(timer);
        if (code !== 0 && code !== 1) {
          // code 1 is normal termination via worker.terminate()
          resolve({
            error: { message: `Worker exited with code ${code}`, name: "WorkerError" },
            result: {},
            store: dumpStore(),
            logs,
          });
        }
      });

      // Send init message
      // Serialize eventContext dates to strings for worker transfer
      const serializableContext = JSON.parse(JSON.stringify(eventContext));
      worker!.postMessage({
        type: "init",
        compiledCodePath,
        event: request.event,
        eventContext: serializableContext,
        variables: request.variables || {},
        workspaceId: request.workspaceId,
      });
    });
    return result;
  } catch (e: any) {
    // Handle compilation errors or other setup failures
    if (e.errors && Array.isArray(e.errors)) {
      const errorMessages = e.errors.map((err: any) => err.text).join("\n");
      return {
        error: {
          message: `Failed to compile function ${request.functionId}:\n${errorMessages}`,
          name: "CompilationError",
        },
        result: {},
        store: dumpStore(),
        logs,
      };
    }
    return {
      error: { message: e.message, name: e.name || "Error", stack: e.stack },
      result: {},
      store: dumpStore(),
      logs,
    };
  } finally {
    // Cleanup: terminate worker
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // Worker may already be terminated
      }
    }
    // Cleanup: remove compiled temp file
    if (compiledCodePath) {
      fsp.unlink(compiledCodePath).catch(() => {});
    }
  }
}
