import http from "http";
import path from "path";
import fs from "fs";
import os from "os";
import zlib from "zlib";
import { promisify } from "util";
import {
  AnyEvent,
  EventContext,
  FuncReturn,
  FullContext,
  JitsuFunction,
  TTLStore,
  FunctionMetrics,
} from "@jitsu/protocols/functions";
import Prometheus from "prom-client";

const gunzip = promisify(zlib.gunzip);
import { disableService, getLog, isTruish, LogLevel, parseNumber, setServerJsonFormat, stopwatch } from "juava";
import {
  EnrichedConnectionConfig,
  FunctionConfig,
  isDropResult,
  FuncChainResult,
  FunctionExecRes,
  FunctionExecLog,
  makeFetch,
  EntityStore,
  createMemoryStore,
  StoreMetrics,
} from "@jitsu/core-functions-lib";
import { getServerEnv } from "./serverEnv";
import { DropRetryErrorName, RetryErrorName, NoRetryErrorName, NoRetryError, RetryError } from "@jitsu/functions-lib";
import { mongodb, createMongoStore } from "./lib/mongodb";
import { warehouseQuery } from "./lib/warehouse-store";
import { parse as semverParse } from "semver";
import * as jsondiffpatch from "jsondiffpatch";
import isEqual from "lodash/isEqual";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { parseUserAgent } from "@jitsu/core-functions-lib";
import type { MongoClient } from "mongodb";
import { compileUdfFunction, compileUdfToIIFE, UDF_TEMP_DIR } from "./lib/udf-shared";
import type {
  InitMessage,
  ExecMessage,
  ProxyResponseMessage,
  WorkerConnectionInit,
  WorkerFunctionInit,
  ResultMessage,
  WorkerToMainMessage,
  StrippedConnectionConfig,
} from "./lib/worker-protocol";

const env = getServerEnv();
const deploymentId = env.DEPLOYMENT_ID || os.hostname();
const jsondiffpatchInstance = jsondiffpatch.create();

disableService("prisma");
disableService("pg");

setServerJsonFormat(env.LOG_FORMAT === "json");

const log = getLog("functions-server");

// Prometheus metrics
Prometheus.collectDefaultMetrics();

const promRequestCount = new Prometheus.Counter({
  name: "fs_request_count2",
  help: "Total number of requests",
  labelNames: ["deploymentId", "endpoint", "actorId", "status"] as const,
});

const promRequestDuration = new Prometheus.Histogram({
  name: "fs_request_duration_ms2",
  help: "Request duration in milliseconds",
  labelNames: ["deploymentId", "endpoint", "actorId"] as const,
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000],
});

const promConcurrentRequests = new Prometheus.Gauge({
  name: "fs_concurrent_requests2",
  help: "Number of concurrent requests being processed",
  labelNames: ["deploymentId", "endpoint"] as const,
});

const promStoreStatuses = new Prometheus.Counter({
  name: "fs_store_statuses2",
  help: "Store operation statuses",
  labelNames: ["deploymentId", "namespace", "operation", "status"] as const,
});

const promWarehouseStatuses = new Prometheus.Histogram({
  name: "fs_warehouse_statuses2",
  help: "Warehouse query statuses",
  labelNames: ["deploymentId", "id", "table", "status"] as const,
  buckets: [0.02, 0.05, 0.2, 0.5, 1, 2],
});

const promMongoPoolCheckedOut = new Prometheus.Gauge({
  name: "fs_mongo_pool_checked_out2",
  help: "Number of MongoDB connections currently checked out",
  labelNames: ["deploymentId"] as const,
});

const promMongoPoolTotal = new Prometheus.Gauge({
  name: "fs_mongo_pool_total2",
  help: "Total number of MongoDB connections in the pool",
  labelNames: ["deploymentId"] as const,
});

const promMongoPoolWaitQueue = new Prometheus.Gauge({
  name: "fs_mongo_pool_wait_queue2",
  help: "Number of operations waiting for a MongoDB connection",
  labelNames: ["deploymentId"] as const,
});

// Overall chain result: success, drop, multiply, error_retry, error_drop, error_drop_retry, error
const promChainResult = new Prometheus.Counter({
  name: "fs_chain_result2",
  help: "Function chain execution results",
  labelNames: ["deploymentId", "actorId", "result", "functionId"] as const,
});

function classifyChainResult(result: FuncChainResultWithLogs): [string, string] {
  for (const entry of result.execLog) {
    if (entry.error) {
      const name = entry.error.name || "Error";
      if (name === DropRetryErrorName) return ["error_drop_retry", entry.functionId];
      if (name === NoRetryErrorName) return ["error_drop", entry.functionId];
      if (name === RetryErrorName) return ["error_retry", entry.functionId];
      return ["error", entry.functionId];
    }
  }
  if (result.events.length === 0) return ["drop", ""];
  if (result.events.length > 1) return ["multiply", ""];
  return ["success", ""];
}

function setupMongoPoolMetrics(client: MongoClient) {
  client.on("connectionCheckedOut", () => promMongoPoolCheckedOut.labels(deploymentId).inc());
  client.on("connectionCheckedIn", () => promMongoPoolCheckedOut.labels(deploymentId).dec());
  client.on("connectionClosed", () => {
    // connectionClosed fires without checkedIn if connection was in use
    // but the gauge self-corrects on next scrape via the periodic sync below
  });

  // Periodically sync from actual pool counters (self-healing)
  setInterval(() => {
    try {
      const topology = (client as any).topology;
      if (!topology) return;
      for (const [, server] of topology.s.servers) {
        const pool = (server as any).pool;
        if (pool) {
          promMongoPoolTotal.labels(deploymentId).set(pool.totalConnectionCount ?? 0);
          promMongoPoolCheckedOut.labels(deploymentId).set(pool.currentCheckedOutCount ?? 0);
          promMongoPoolWaitQueue.labels(deploymentId).set(pool.waitQueueSize ?? 0);
          break; // single server is enough for non-sharded setup
        }
      }
    } catch (_) {
      // ignore - topology may not be ready
    }
  }, 5000);
}

const metricsPort = parseInt(env.ROTOR_METRICS_PORT || "9091");

// Types
type LoadedFunction = {
  id: string;
  exec: JitsuFunction;
  config?: any;
};

type FunctionChainContext = {
  store: TTLStore;
  query: (conId: string, query: string, params?: any) => Promise<any>;
  metrics?: FunctionMetrics;
  connectionOptions?: any;
};

type FunctionChain = {
  context: FunctionChainContext;
  connectionId: string;
  connection: StrippedConnectionConfig;
  functions: LoadedFunction[];
};

// Log entry type
type LogEntry = {
  level: "info" | "warn" | "debug" | "error";
  functionId: string;
  functionType: string;
  message: any;
  args?: any[];
  timestamp: Date;
};

// Collecting function logger - stores logs and also outputs to console
// debugTill: when set and in the future, debug-level logs are collected; otherwise they are suppressed
function createCollectingLogger(
  functionId: string,
  functionType: string,
  logEntries: LogEntry[],
  debugTill?: Date,
  logToConsole: boolean = false
) {
  const addEntry = (level: LogEntry["level"], message: string, args: any[]) => {
    // Same as makeLog: debug logs only when debugTill is active
    if (level === "debug" && !(debugTill && debugTill.getTime() > Date.now())) {
      return;
    }
    logEntries.push({
      level,
      functionId,
      functionType,
      message,
      args: args.length > 0 ? args : undefined,
      timestamp: new Date(),
    });
    if (logToConsole) {
      const logFn =
        level === "error"
          ? log.atError()
          : level === "warn"
          ? log.atWarn()
          : level === "debug"
          ? log.atDebug()
          : log.atInfo();
      logFn.log(`[${functionId}] ${message}`, ...args);
    }
  };

  return {
    info: (message: string, ...args: any[]) => addEntry("info", message, args),
    warn: (message: string, ...args: any[]) => addEntry("warn", message, args),
    debug: (message: string, ...args: any[]) => addEntry("debug", message, args),
    error: (message: string, ...args: any[]) => addEntry("error", message, args),
  };
}

// Load JSON config file (supports .json and .json.gz)
async function loadJsonFile<T>(filePath: string): Promise<T> {
  if (filePath.endsWith(".gz")) {
    const compressed = fs.readFileSync(filePath);
    const decompressed = await gunzip(compressed);
    return JSON.parse(decompressed.toString("utf-8")) as T;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as T;
}

// Check if file is a JSON config file (.json or .json.gz)
function isJsonConfigFile(filename: string): boolean {
  return filename.endsWith(".json") || filename.endsWith(".json.gz");
}

// Load function configs from a directory
// Supports two naming conventions:
// 1. ${functionId}.json.gz - simple format
// 2. ${workspaceId}__${functionId}.json.gz - workspace-prefixed format (for multi-workspace deployments)
async function loadFunctionsFromDir(dir: string, functions: Map<string, FunctionConfig>): Promise<void> {
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir)) {
    if (!isJsonConfigFile(file)) continue;
    try {
      const config = await loadJsonFile<FunctionConfig>(path.join(dir, file));
      functions.set(config.id, config);
      const compressed = file.endsWith(".gz") ? " (compressed)" : "";
      log.atDebug().log(`✓ Loaded function: ${config.id} (${config.name})${compressed}`);
    } catch (e: any) {
      log.atError().log(`✗ Failed to load function ${file}: ${e.message}`);
    }
  }
}

// Load connections from a directory
async function loadConnectionsFromDir(dir: string, connections: Map<string, EnrichedConnectionConfig>): Promise<void> {
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir)) {
    if (!isJsonConfigFile(file)) continue;
    // Expect format: ${workspaceId}__connections.json.gz
    if (!file.includes("__connections")) continue;

    try {
      const allConnections = await loadJsonFile<EnrichedConnectionConfig[]>(path.join(dir, file));
      for (const config of allConnections) {
        connections.set(config.id, config);
        log.atDebug().log(`✓ Loaded connection: ${config.id}`);
      }
      const compressed = file.endsWith(".gz") ? " (compressed)" : "";
      log.atInfo().log(`Loaded ${allConnections.length} connections from ${file}${compressed}`);
    } catch (e: any) {
      log.atError().log(`✗ Failed to load connections from ${file}: ${e.message}`);
    }
  }
}

// Load configs from filesystem
// Directory structure:
//   - connections/part-{n}/${workspaceId}__connections.json.gz
//   - functions/part-{n}/${workspaceId}__${functionId}.json.gz
async function loadConfigsFromFiles(configDir: string): Promise<{
  connections: Map<string, EnrichedConnectionConfig>;
  functions: Map<string, FunctionConfig>;
}> {
  const connections = new Map<string, EnrichedConnectionConfig>();
  const functions = new Map<string, FunctionConfig>();

  if (!fs.existsSync(configDir)) {
    log.atWarn().log(`Config directory does not exist: ${configDir}`);
    return { connections, functions };
  }

  // Load connections from /data/connections/part-{n}/${workspaceId}__connections.json.gz
  const connectionsDir = path.join(configDir, "connections");
  if (fs.existsSync(connectionsDir)) {
    // Load from main connections directory
    await loadConnectionsFromDir(connectionsDir, connections);

    // Load from partitioned directories (connections/part-0, connections/part-1, etc.)
    for (const entry of fs.readdirSync(connectionsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("part-")) {
        const partDir = path.join(connectionsDir, entry.name);
        log.atInfo().log(`Loading connections from connections/${entry.name}`);
        await loadConnectionsFromDir(partDir, connections);
      }
    }
  }

  // Load functions from /data/functions/part-{n}/${workspaceId}__${functionId}.json.gz
  const functionsDir = path.join(configDir, "functions");
  if (fs.existsSync(functionsDir)) {
    // Load from main functions directory
    await loadFunctionsFromDir(functionsDir, functions);

    // Load from partitioned directories (functions/part-0, functions/part-1, etc.)
    for (const entry of fs.readdirSync(functionsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("part-")) {
        const partDir = path.join(functionsDir, entry.name);
        log.atInfo().log(`Loading functions from functions/${entry.name}`);
        await loadFunctionsFromDir(partDir, functions);
      }
    }
  }

  return { connections, functions };
}

// Clear all contents of a directory (files and subdirectories)
async function clearDirectory(dir: string, label: string): Promise<void> {
  try {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
    log.atInfo().log(`Cleared ${label}: ${dir} (${entries.length} entries removed)`);
  } catch (e: any) {
    log.atWarn().log(`Failed to clear ${label} (${dir}): ${e.message}`);
  }
}

// Strip credentials from connection config (safe to store in chain / send to worker)
function stripConnection(connection: EnrichedConnectionConfig): StrippedConnectionConfig {
  const { credentials, credentialsHash, ...connWithoutCreds } = connection;
  const strippedOptions = { ...connWithoutCreds.options };
  delete strippedOptions.functionsEnv;
  return { ...connWithoutCreds, options: strippedOptions };
}

// Build function chain for a connection (UDF functions only) — runs in main process
async function buildFunctionChain(
  conEntityStore: EntityStore<EnrichedConnectionConfig>,
  connection: EnrichedConnectionConfig,
  functionsStore: Map<string, FunctionConfig>
): Promise<FunctionChain> {
  const connectionData = connection.options as any;
  const funcs: LoadedFunction[] = [];

  // Add UDF functions only - compile from FunctionConfig.code
  const udfs = (connectionData?.functions || []).filter((f: any) => f.functionId.startsWith("udf."));
  for (const f of udfs) {
    const functionId = f.functionId.substring(4); // Remove "udf." prefix
    const funcConfig = functionsStore.get(functionId);
    if (funcConfig && funcConfig.code) {
      try {
        const udfFunc = await compileUdfFunction(
          connection.id,
          funcConfig.code,
          functionId,
          connectionData.functionsEnv
        );
        funcs.push({
          id: f.functionId,
          exec: udfFunc.default,
          config: udfFunc.config,
        });
        log.atDebug().log(`  ✓ Compiled UDF: ${functionId}`);
      } catch (e: any) {
        log.atError().log(`  ✗ Failed to compile UDF ${functionId}: ${e.message}`);
        // Create a replacement function that throws the compilation error as NoRetryError
        const compilationError = e.message;
        funcs.push({
          id: f.functionId,
          exec: async () => {
            throw new RetryError(compilationError);
          },
          config: undefined,
        });
        log.atDebug().log(`  ⚠ Added error-throwing placeholder for UDF: ${functionId}`);
      }
    } else {
      log.atWarn().log(`UDF not found or has no code: ${functionId}`);
      // Create a replacement function that throws the "not found" error as NoRetryError
      funcs.push({
        id: f.functionId,
        exec: async () => {
          throw new RetryError(`Function ${functionId} not found or has no code`);
        },
        config: undefined,
      });
      log.atDebug().log(`  ⚠ Added error-throwing placeholder for missing UDF: ${functionId}`);
    }
  }
  // Create shared store - use MongoDB if MONGODB_URL is provided, otherwise fall back to in-memory
  const storeMetrics: StoreMetrics = {
    storeStatus: (namespace, operation, status) =>
      promStoreStatuses.labels(deploymentId, namespace, operation, status).inc(),
    warehouseStatus: (id, table, status, timeMs) =>
      promWarehouseStatuses.labels(deploymentId, id, table, status).observe(timeMs / 1000),
  };
  let store: TTLStore;
  if (env.MONGODB_URL) {
    store = createMongoStore(connection.workspaceId, mongodb, false, isTruish(env.FAST_STORE), storeMetrics);
  } else {
    log.atInfo().log(`Using in-memory store (MONGODB_URL not set)`);
    store = createMemoryStore({});
  }

  const isFreeClass = env.FUNCTIONS_CLASS === "free";
  const chainCtx: FunctionChainContext = {
    store,
    query: isFreeClass
      ? async () => {
          throw new Error("Warehouse queries are not available on the free plan. Please upgrade to use this feature.");
        }
      : async (conId: string, query: string, params: any) => {
          return warehouseQuery(connection.workspaceId, conEntityStore, conId, query, params, storeMetrics);
        },
    connectionOptions: connectionData,
  };

  return {
    context: chainCtx,
    connectionId: connection.id,
    connection: stripConnection(connection),
    functions: funcs,
  };
}

// Extended result type with logs
type FuncChainResultWithLogs = FuncChainResult & {
  logs: LogEntry[];
};

// Deep copy helper (same as legacy udf-wrapper)
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

function recordChainResultMetrics(result: Required<FuncChainResultWithLogs>) {
  // Overall chain result
  promChainResult.labels(deploymentId, result.connectionId, ...classifyChainResult(result)).inc();
}

// Run function chain
async function runChain(
  chain: FunctionChain,
  event: AnyEvent,
  eventContext: EventContext,
  fetchTimeoutMs: number = 2000
): Promise<Required<FuncChainResultWithLogs>> {
  const execLog: FunctionExecLog = [];
  const logs: LogEntry[] = [];
  let events: AnyEvent[] = [event];
  const chainCtx = chain.context;

  for (let k = 0; k < chain.functions.length; k++) {
    const func = chain.functions[k];
    const newEvents: AnyEvent[] = [];

    for (let i = 0; i < events.length; i++) {
      const currentEvent = events[i];
      const sw = stopwatch();
      let result: FuncReturn = undefined;

      // Extract function type from function id (e.g., "udf.myFunction" -> "udf")
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
        // Get retries from eventContext (passed from rotor)
        const retries = (eventContext as EventContext & { retries?: number }).retries ?? 0;
        const debugTill = chainCtx.connectionOptions?.debugTill
          ? new Date(chainCtx.connectionOptions?.debugTill)
          : undefined;
        const fetchLogEnabled =
          chainCtx.connectionOptions?.fetchLogLevel !== "debug" || (debugTill && debugTill.getTime() > Date.now());
        const fullContext: FullContext = {
          ...eventContext,
          log: createCollectingLogger(id, functionType, logs, debugTill),
          fetch: makeFetch(
            chain.connectionId,
            {
              log(connectionId: string, level: LogLevel, msg: Record<string, any>) {
                if (!fetchLogEnabled) {
                  return;
                }
                logs.push({
                  level,
                  functionId: id,
                  functionType,
                  message: {
                    ...msg,
                    functionId: id,
                    functionType,
                  },
                  timestamp: new Date(),
                });
              },
              close() {},
              deadLetter(workspaceId: string, connectionId: string, type: string, payload: any, error: any) {
                throw new Error("deadLetter method must never be called inside functions server.");
              },
            },
            chainCtx.connectionOptions?.fetchLogLevel || "info",
            fetchTimeoutMs
          ),
          store: chainCtx.store,
          props: chainCtx.connectionOptions?.functionsEnv || {},
          retries,
          getWarehouse: (destinationId: string) => {
            return {
              query: (sql: string, params?: Record<string, any>) => chainCtx.query(destinationId, sql, params),
            };
          },
        };

        // Pass a deep copy to the function (same as legacy udf-wrapper)
        result = await func.exec(deepCopy(currentEvent), fullContext);

        // Check for multiple events in middle of chain (same as legacy udf-wrapper)
        if (k < chain.functions.length - 1 && Array.isArray(result) && result.length > 1) {
          const l = result.length;
          result = undefined;
          const multiEventError = new Error(
            `Got ${l} events as result of function #${k + 1} of ${
              chain.functions.length
            }. Only the last function in a chain is allowed to multiply events.`
          );
          multiEventError.name = NoRetryErrorName;
          throw multiEventError;
        }
      } catch (err: any) {
        if (err?.name === DropRetryErrorName || err?.name === NoRetryErrorName) {
          result = "drop";
        }
        // Set retryPolicy from function config (same pattern as legacy udf-wrapper)
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
        log.atError().withCause(err).log(`Function ${func.id} error.`);
      }

      execLogEntry.ms = sw.elapsedMs();
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
    if (events.length === 0) {
      break;
    }
  }

  return { connectionId: chain.connectionId, events, execLog, logs };
}

// Map diff helper - optimizes response size by sending diffs when possible
function mapDiff(originalEvent: AnyEvent, newEvents?: AnyEvent[]) {
  if (!newEvents) {
    return [];
  }

  return newEvents.map(e => {
    if (isEqual(originalEvent, e)) {
      return "same";
    }
    let supportsDiff = false;
    const library = (originalEvent as any)?.context?.library;
    if (library?.name === "@jitsu/js") {
      const semver = semverParse(library.version);
      if (semver && semver.major >= 2) {
        supportsDiff = true;
      }
    }
    if (!supportsDiff) {
      return e;
    }

    const originalSize = JSON.stringify(originalEvent).length;
    const diff = jsondiffpatchInstance.diff(originalEvent, e);
    if (!diff) {
      return "same";
    }
    const diffSize = JSON.stringify(diff).length;
    if (diffSize > originalSize) {
      return e;
    } else {
      return { __diff: diff };
    }
  });
}

// Parse request body
async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Create event context from IngestMessage and connection (compatible with FunctionsHandlerMulti)
function createEventContextFromMessage(
  message: IngestMessage,
  connection: StrippedConnectionConfig,
  retries: number = 0
): EventContext {
  return {
    receivedAt: new Date(message.messageCreated),
    headers: message.httpHeaders,
    geo: message.geo,
    ua: parseUserAgent((message.httpPayload as any)?.context?.userAgent),
    retries,
    source: {
      type: message.ingestType,
      id: message.origin?.sourceId || connection.streamId,
      name: message.origin?.sourceName || connection.streamName,
      domain: message.origin?.domain,
    },
    destination: {
      id: connection.destinationId,
      type: connection.type,
      updatedAt: connection.updatedAt,
      hash: connection.optionsHash,
    },
    connection: {
      id: connection.id,
      options: connection.options,
    },
    workspace: {
      id: connection.workspaceId,
    },
  };
}

// ── Workspace Worker management (Deno Web Workers with permissions: "none") ──

type WorkspaceWorker = {
  worker: Worker;
  pending: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  ready: Promise<void>;
};

const workspaceWorkers = new Map<string, WorkspaceWorker>();
// connectionId → workspaceId mapping (for free tier worker dispatch)
const connectionToWorkspace = new Map<string, string>();

function getWorkerUrl(): string {
  return new URL("./workspace-worker.mjs", import.meta.url).href;
}

function createWorkspaceWorker(
  workspaceId: string,
  connections: WorkerConnectionInit[],
  store: TTLStore,
  conEntityStore: EntityStore<EnrichedConnectionConfig>
): WorkspaceWorker {
  const worker = new Worker(getWorkerUrl(), {
    type: "module",
    // @ts-ignore Deno-specific option for sandboxing
    deno: { permissions: "none" },
  });

  const pendingExec = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let readyResolve: () => void;
  const readyPromise = new Promise<void>(resolve => {
    readyResolve = resolve;
  });

  const fetchImpl = makeFetch(
    `ws-${workspaceId}`,
    { log() {}, close() {}, deadLetter() {} },
    "info",
    parseNumber(env.FETCH_TIMEOUT_MS, 2000)
  );

  worker.onmessage = async (e: MessageEvent<WorkerToMainMessage>) => {
    const msg = e.data;

    if (msg.type === "ready") {
      readyResolve!();
      return;
    }

    if (msg.type === "result") {
      const p = pendingExec.get(msg.requestId);
      if (p) {
        pendingExec.delete(msg.requestId);
        p.resolve(msg);
      }
      return;
    }

    if (msg.type === "log") {
      return; // fire-and-forget
    }

    if (msg.type === "debug") {
      log.atInfo().log(`[Worker ${workspaceId} DEBUG] ${JSON.stringify(msg.value)}`);
      return; // fire-and-forget
    }

    if (msg.type === "proxyRequest") {
      const { callId, method, args } = msg;
      try {
        let result: any;
        if (method.startsWith("store.")) {
          const op = method.split(".")[1];
          result = await (store as any)[op](...args);
        } else if (method === "fetch") {
          const [url, init] = args;
          const res = await fetchImpl(url, init);
          const headers: Record<string, string> = {};
          res.headers.forEach((v: string, k: string) => {
            headers[k] = v;
          });
          result = {
            status: res.status,
            statusText: res.statusText,
            ok: res.ok,
            url: res.url,
            type: res.type,
            redirected: res.redirected,
            headers,
            body: await res.text(),
          };
        } else if (method === "warehouse.query") {
          const [destinationId, sql, params] = args;
          const storeMetrics: StoreMetrics = {
            storeStatus: (ns, op, st) => promStoreStatuses.labels(deploymentId, ns, op, st).inc(),
            warehouseStatus: (id, tbl, st, ms) =>
              promWarehouseStatuses.labels(deploymentId, id, tbl, st).observe(ms / 1000),
          };
          result = await warehouseQuery(workspaceId, conEntityStore, destinationId, sql, params, storeMetrics);
        }
        const response: ProxyResponseMessage = { type: "proxyResponse", callId, result };
        worker.postMessage(response);
      } catch (err: any) {
        const response: ProxyResponseMessage = { type: "proxyResponse", callId, error: err.message };
        worker.postMessage(response);
      }
    }
  };

  worker.onerror = e => {
    log.atError().log(`Worker error for workspace ${workspaceId}: ${e.message}`);
  };

  // Send init message
  const initMsg: InitMessage = { type: "init", connections };
  worker.postMessage(initMsg);

  return { worker, pending: pendingExec, ready: readyPromise };
}

async function execInWorker(
  ws: WorkspaceWorker,
  connectionId: string,
  event: AnyEvent,
  eventContext: EventContext,
  fetchTimeoutMs: number
): Promise<ResultMessage> {
  await ws.ready;
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    ws.pending.set(requestId, { resolve, reject });
    const execMsg: ExecMessage = {
      type: "exec",
      requestId,
      connectionId,
      event,
      eventContext: JSON.parse(JSON.stringify(eventContext)),
      fetchTimeoutMs,
    };
    ws.worker.postMessage(execMsg);
  });
}

// ── /udfrun: run a single UDF in a temporary Deno Web Worker ──
async function runUdfInWorker(
  request: any,
  store: TTLStore,
  conEntityStore: EntityStore<EnrichedConnectionConfig>
): Promise<any> {
  const logs: any[] = [];
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
      warehouseEnabled: env.FUNCTIONS_CLASS !== "free",
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

    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({
          error: { message: `Function execution timed out after ${udfTimeoutMs}ms`, name: "TimeoutError" },
          result: {},
          store: dumpStore(),
          logs,
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
          worker.terminate();
          const hasError = msg.execLog?.some((e: any) => e.error);
          if (hasError) {
            const err = msg.execLog.find((e: any) => e.error)?.error;
            resolve({
              error: { message: err.message, stack: err.stack, name: err.name, retryPolicy: err.retryPolicy },
              result: {},
              store: dumpStore(),
              logs,
            });
          } else {
            const dropped = msg.events.length === 0;
            resolve({
              dropped,
              result: dropped ? {} : msg.events.length === 1 ? msg.events[0] : msg.events,
              store: dumpStore(),
              logs,
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
              const [url, init] = args;
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
              if (env.FUNCTIONS_CLASS === "free") {
                throw new Error("Warehouse queries are not available on the free plan.");
              }
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
          logs,
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
        logs,
      };
    }
    return {
      error: { message: e.message, name: e.name || "Error", stack: e.stack },
      result: {},
      store: dumpStore(),
      logs,
    };
  }
}

async function main() {
  if (env.MONGODB_URL) {
    const mongoClient = await mongodb.waitInit();
    setupMongoPoolMetrics(mongoClient);
  }
  const port = parseInt(env.PORT);
  const configDir = path.resolve(env.CONFIG_DIR);

  // Load configs from files
  log.atInfo().log(`Loading configs from files: ${configDir}`);

  let { connections, functions } = await loadConfigsFromFiles(configDir);
  const conEntityStore: EntityStore<EnrichedConnectionConfig> = {
    getObject: (id: string) => {
      return connections.get(id);
    },
    getAll() {
      return Object.fromEntries(connections);
    },
    toJSON() {
      return JSON.stringify(Object.fromEntries(connections));
    },
    enabled: true,
  };

  if (connections.size === 0) {
    log.atWarn().log("No connections found");
  }

  // Function chains cache - stores promises to avoid parallel builds for the same connection
  let chains = new Map<string, Promise<FunctionChain | undefined>>();

  const isFreeClass = env.FUNCTIONS_CLASS === "free";

  if (isFreeClass) {
    // Free tier: compile UDFs to IIFE strings and spawn one Deno Web Worker per workspace.
    // Workers run with permissions: "none" — all I/O is proxied back to the main process.
    const workspaceConnections = new Map<string, WorkerConnectionInit[]>();

    for (const [connectionId, connection] of connections) {
      const wsId = connection.workspaceId;
      if (!workspaceConnections.has(wsId)) {
        workspaceConnections.set(wsId, []);
      }

      const connectionData = connection.options as any;
      const udfs = (connectionData?.functions || []).filter((f: any) => f.functionId.startsWith("udf."));
      const workerFuncs: WorkerFunctionInit[] = [];

      for (const f of udfs) {
        const functionId = f.functionId.substring(4);
        const funcConfig = functions.get(functionId);
        if (funcConfig && funcConfig.code) {
          try {
            const iifeCode = await compileUdfToIIFE(funcConfig.code, functionId, connectionData.functionsEnv);
            workerFuncs.push({ id: f.functionId, iifeCode });
            log.atDebug().log(`  ✓ Compiled UDF to IIFE: ${functionId}`);
          } catch (e: any) {
            log.atError().log(`  ✗ Failed to compile UDF ${functionId}: ${e.message}`);
            const errorIife = `var __udf = { default: async function() { throw new Error(${JSON.stringify(
              e.message
            )}); } };`;
            workerFuncs.push({ id: f.functionId, iifeCode: errorIife });
          }
        } else {
          const msg = `Function ${functionId} not found or has no code`;
          log.atWarn().log(msg);
          const errorIife = `var __udf = { default: async function() { throw new Error(${JSON.stringify(msg)}); } };`;
          workerFuncs.push({ id: f.functionId, iifeCode: errorIife });
        }
      }

      workspaceConnections.get(wsId)!.push({
        connectionId,
        connection: stripConnection(connection),
        functions: workerFuncs,
        warehouseEnabled: false,
        debugTill: connectionData?.debugTill,
        fetchLogLevel: connectionData?.fetchLogLevel,
        props: connectionData?.functionsEnv || {},
      });

      connectionToWorkspace.set(connectionId, wsId);
    }

    // Spawn one worker per workspace
    for (const [wsId, conns] of workspaceConnections) {
      log.atInfo().log(`Spawning worker for workspace ${wsId} (${conns.length} connections)`);
      const storeMetrics: StoreMetrics = {
        storeStatus: (ns, op, st) => promStoreStatuses.labels(deploymentId, ns, op, st).inc(),
        warehouseStatus: (id, tbl, st, ms) =>
          promWarehouseStatuses.labels(deploymentId, id, tbl, st).observe(ms / 1000),
      };
      const store = env.MONGODB_URL
        ? createMongoStore(wsId, mongodb, false, isTruish(env.FAST_STORE), storeMetrics)
        : createMemoryStore({});

      try {
        const ws = createWorkspaceWorker(wsId, conns, store, conEntityStore);
        workspaceWorkers.set(wsId, ws);
      } catch (e: any) {
        log.atError().log(`Failed to spawn worker for workspace ${wsId}: ${e.message}`);
      }
    }

    log.atInfo().log(`Spawned ${workspaceWorkers.size} workspace workers`);
  } else {
    // Non-free: prebuild function chains in main process (same as before)
    if (connections.size > 0) {
      log.atInfo().log(`Prebuilding function chains for ${connections.size} connections...`);
      const prebuildStart = Date.now();

      for (const [connectionId, connection] of connections) {
        await buildFunctionChain(conEntityStore, connection, functions)
          .then(chain => {
            log.atInfo().log(`✓ Prebuilt chain for connection: ${connectionId} (${chain.functions.length} functions)`);
            chains.set(connectionId, Promise.resolve(chain));
          })
          .catch(e => {
            log.atError().log(`✗ Failed to prebuild chain for ${connectionId}: ${e.message}`);
            chains.set(connectionId, Promise.resolve(undefined));
          });
      }

      const prebuildMs = Date.now() - prebuildStart;
      log.atInfo().log(`Prebuilt ${chains.size} function chains in ${prebuildMs}ms`);
    }
  }

  // Functions map is no longer needed after prebuilding (code is compiled into chains)
  functions.clear();
  log.atInfo().log(`Cleared functions map`);

  if (isFreeClass) {
    await clearDirectory(configDir, "CONFIG_DIR");
    await clearDirectory(UDF_TEMP_DIR, "UDF_TEMP_DIR");
    connections.clear();
    log.atInfo().log(`Cleared connections map and config directories (free deployment)`);
  }

  // Get prebuilt chain for a connection (no lazy loading)
  function getChain(connectionId: string): Promise<FunctionChain | undefined> | undefined {
    return chains.get(connectionId);
  }

  // HTTP response helpers
  function sendJson(res: http.ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  function sendError(res: http.ServerResponse, status: number, error: string): void {
    sendJson(res, status, { error });
  }

  // Health check handler: GET /health or GET /
  function handleHealth(res: http.ServerResponse): void {
    sendJson(res, 200, {
      status: "ok",
      configDir,
      connections: Array.from(connections.keys()),
      cachedChains: Array.from(chains.keys()),
      workers: Array.from(workspaceWorkers.keys()),
    });
  }

  // Multi connection handler: POST /multi?ids=conn1,conn2,conn3&fullEvents=true
  // Compatible with FunctionsHandlerMulti in rotor
  // Expects IngestMessage as body payload
  // Query params:
  //   - ids: comma-separated connection IDs (required)
  //   - fullEvents: if "true", return full events instead of diffs
  async function handleMulti(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<string> {
    if (req.method !== "POST") {
      sendError(res, 405, "Method not allowed. Use POST.");
      return "";
    }

    const connectionIds = (url.searchParams.get("ids") ?? "").split(",").filter(id => !!id);
    const fullEvents = url.searchParams.get("fullEvents") === "true";

    if (connectionIds.length === 0) {
      sendError(res, 400, "No connection IDs provided. Use ?ids=conn1,conn2,...");
      return "";
    }

    const message = (await parseBody(req)) as IngestMessage;
    const event = message.httpPayload;
    if (!event.context) {
      event.context = {};
    }

    type StrictFuncChainResult = Required<FuncChainResultWithLogs>;

    // actorId = streamId of first connection (for metrics)
    let actorId = connectionIds[0] || "";
    if (!isFreeClass) {
      const firstChain = await getChain(connectionIds[0]);
      actorId = firstChain?.connection?.streamId || actorId;
    }

    const functionsFetchTimeout = req.headers["x-request-timeout-ms"]
      ? parseNumber(req.headers["x-request-timeout-ms"] as string, 2000)
      : parseNumber(env.FETCH_TIMEOUT_MS, 2000);

    // Process all connections in parallel
    const promises = connectionIds.map(async (connectionId): Promise<StrictFuncChainResult> => {
      try {
        if (isFreeClass) {
          // Dispatch to workspace worker
          const wsId = connectionToWorkspace.get(connectionId)!;
          const ws = wsId ? workspaceWorkers.get(wsId) : undefined;
          if (!ws) {
            return {
              connectionId,
              events: [],
              execLog: [
                {
                  error: { message: `Connection '${connectionId}' not found`, name: NoRetryErrorName },
                  ms: 0,
                  eventIndex: 0,
                  functionId: "",
                },
              ],
              logs: [],
            } as StrictFuncChainResult;
          }
          const eventContext = createEventContextFromMessage(message, { id: connectionId } as StrippedConnectionConfig);
          const resultMsg = await execInWorker(ws, connectionId, event, eventContext, functionsFetchTimeout);
          return {
            connectionId: resultMsg.connectionId,
            events: resultMsg.events,
            execLog: resultMsg.execLog,
            logs: resultMsg.logs.map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) })),
          };
        } else {
          // Run in main process
          const chain = await getChain(connectionId);
          if (!chain) {
            return {
              connectionId,
              events: [],
              execLog: [
                {
                  error: { message: `Connection '${connectionId}' not found`, name: NoRetryErrorName },
                  ms: 0,
                  eventIndex: 0,
                  functionId: "",
                },
              ],
              logs: [],
            } as StrictFuncChainResult;
          }
          const eventContext = createEventContextFromMessage(message, chain.connection, 0);
          const result = await runChain(chain, event, eventContext, functionsFetchTimeout);
          const totalMs = result.execLog.reduce((sum, e) => sum + (e.ms || 0), 0);
          log.atDebug().log(`← ${connectionId} (${chain.functions.length} functions) completed in ${totalMs}ms`);
          return result;
        }
      } catch (e: any) {
        const errorMessage = `${e.name}: ${e.message}`;
        log.atError().log(`[multi] Error processing connection ${connectionId}: ${errorMessage}`);
        return {
          connectionId,
          execLog: [{ error: { message: errorMessage, name: NoRetryErrorName }, ms: 0, eventIndex: 0, functionId: "" }],
          events: [],
          logs: [],
        } as StrictFuncChainResult;
      }
    });

    const results = await Promise.all(promises);

    // Build response with events and execLog
    // Map connectionId -> { events, execLog }
    const response = Object.fromEntries(
      results.map(result => {
        recordChainResultMetrics(result);
        return [
          result.connectionId,
          {
            events: fullEvents ? result.events || [] : mapDiff(message.httpPayload, result.events),
            execLog: result.execLog,
            logs: result.logs || [],
          },
        ];
      })
    );

    sendJson(res, 200, response);
    return actorId;
  }

  // Single connection handler: POST /connection/<connection-id>
  async function handleConnection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    connectionId: string
  ): Promise<string> {
    if (req.method !== "POST") {
      sendError(res, 405, "Method not allowed. Use POST.");
      return connectionId;
    }

    const body = await parseBody(req);
    const event = body.event as AnyEvent;
    const eventContext = body.context as EventContext;

    if (eventContext?.receivedAt && typeof eventContext.receivedAt === "string") {
      eventContext.receivedAt = new Date(eventContext.receivedAt);
    }
    if (eventContext?.destination?.updatedAt && typeof eventContext.destination.updatedAt === "string") {
      eventContext.destination.updatedAt = new Date(eventContext.destination.updatedAt);
    }

    const functionsFetchTimeout = req.headers["x-request-timeout-ms"]
      ? parseNumber(req.headers["x-request-timeout-ms"] as string, 2000)
      : parseNumber(env.FETCH_TIMEOUT_MS, 2000);

    if (isFreeClass) {
      const wsId = connectionToWorkspace.get(connectionId);
      const ws = wsId ? workspaceWorkers.get(wsId) : undefined;
      if (!ws) {
        sendError(res, 404, `Connection '${connectionId}' not found`);
        return connectionId;
      }
      const resultMsg = await execInWorker(ws, connectionId, event, eventContext, functionsFetchTimeout);
      const result: FuncChainResultWithLogs = {
        connectionId: resultMsg.connectionId,
        events: resultMsg.events,
        execLog: resultMsg.execLog,
        logs: resultMsg.logs.map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) })),
      };
      sendJson(res, 200, result);
    } else {
      const chain = await getChain(connectionId);
      if (!chain) {
        sendError(res, 404, `Connection '${connectionId}' not found`);
        return connectionId;
      }
      const result = await runChain(chain, event, eventContext, functionsFetchTimeout);
      recordChainResultMetrics(result);
      const totalMs = result.execLog.reduce((sum, e) => sum + (e.ms || 0), 0);
      log.atDebug().log(`← ${connectionId} (${chain.functions.length} functions) completed in ${totalMs}ms`);
      sendJson(res, 200, result);
    }

    return connectionId;
  }

  // Create HTTP server
  let isShuttingDown = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (isShuttingDown) {
      res.setHeader("Connection", "close");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    try {
      // Health check
      if (pathname === "/health" || pathname === "/") {
        handleHealth(res);
        return;
      }

      const endpoint = pathname === "/multi" ? "multi" : pathname.startsWith("/connection/") ? "connection" : "other";
      const sw = stopwatch();
      promConcurrentRequests.labels(deploymentId, endpoint).inc();
      let actorId = "";

      try {
        // Multi connection handler
        if (pathname === "/multi") {
          actorId = await handleMulti(req, res, url);
          return;
        }

        // UDF test runner
        if (pathname === "/udfrun" && req.method === "POST") {
          const body = await parseBody(req);
          log.atInfo().log(`[udfrun] Running function: ${body?.functionId} workspace: ${body?.workspaceId}`);
          const udfStore = env.MONGODB_URL
            ? createMongoStore(body.workspaceId, mongodb, true, false)
            : createMemoryStore(body.store || {});
          const result = await runUdfInWorker(body, udfStore, conEntityStore);
          if (result.error) {
            log
              .atError()
              .log(
                `[udfrun] Error running function: ${body?.functionId} workspace: ${body?.workspaceId}\n${result.error.name}: ${result.error.message}`
              );
          }
          result.backend = "functions-server";
          sendJson(res, 200, result);
          return;
        }

        // Single connection handler
        const match = pathname.match(/^\/connection\/([^\/]+)$/);
        if (match) {
          actorId = await handleConnection(req, res, match[1]);
          return;
        }

        // Not found
        sendError(res, 404, "Not found. Use /connection/<connection-id>, /multi?ids=conn1,conn2,..., or /udfrun");
      } finally {
        promConcurrentRequests.labels(deploymentId, endpoint).dec();
        promRequestDuration.labels(deploymentId, endpoint, actorId).observe(sw.elapsedMs());
        promRequestCount.labels(deploymentId, endpoint, actorId, String(res.statusCode || 200)).inc();
      }
    } catch (e: any) {
      log.atError().log(`Error processing request:`, e);
      sendError(res, 500, e.message);
    }
  });

  server.listen(port, () => {
    log.atInfo().log(`Server running at http://localhost:${port}`);
    log.atInfo().log(`Available connections: ${connections.size}`);
    if (isFreeClass) {
      log.atInfo().log(`Workspace workers: ${workspaceWorkers.size}`);
    }
  });

  // Metrics HTTP server (separate port, same as rotor)
  const metricsServer = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": Prometheus.register.contentType });
      const result = await Prometheus.register.metrics();
      res.end(result);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  metricsServer.listen(metricsPort, () => {
    log.atInfo().log(`Metrics server running at http://localhost:${metricsPort}/metrics`);
  });

  // Graceful shutdown handler
  const shutdown = (signal: string) => {
    if (isShuttingDown) {
      log.atInfo().log(`Already shutting down, ignoring ${signal}`);
      return;
    }
    isShuttingDown = true;
    log.atInfo().log(`Received ${signal}, starting graceful shutdown...`);

    // Force exit after timeout if connections don't drain
    const forceExitTimeout = 30000; // 30 seconds
    setTimeout(() => {
      log.atWarn().log(`Forcing exit after ${forceExitTimeout}ms timeout`);
      process.exit(1);
    }, forceExitTimeout);

    // wait some seconds for connections to drain before shutting down metrics server
    const extraDelay = env.SHUTDOWN_EXTRA_DELAY_SEC ? 1000 * parseInt(env.SHUTDOWN_EXTRA_DELAY_SEC) : 5000;
    setTimeout(() => {
      // Terminate all workspace workers
      for (const [wsId, ws] of workspaceWorkers) {
        ws.worker.terminate();
        log.atInfo().log(`Terminated worker for workspace ${wsId}`);
      }

      server.close(err => {
        if (err) {
          log.atError().log(`Error during server close:`, err);
          process.exit(1);
        }
        log.atInfo().log(`Server closed, all connections drained`);
        process.exit(0);
      });
    }, extraDelay);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(e => {
  log.atError().withCause(e).log("Fatal error");
  process.exit(1);
});
