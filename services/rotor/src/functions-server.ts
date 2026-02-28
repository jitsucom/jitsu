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
import { Agent, setGlobalDispatcher } from "undici";
import { runUdfInWorker } from "./lib/udf-worker-runner";
import { compileUdfFunction } from "./lib/udf-shared";

setGlobalDispatcher(
  new Agent({
    connections: 500, // per origin
  })
);

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
  }, 5000).unref();
}

const metricsPort = parseInt(env.ROTOR_METRICS_PORT || "9091");

// Types
type LoadedFunction = {
  id: string;
  exec: JitsuFunction;
  config?: any;
};

type FunctionChainContext = {
  // log: {
  //   info: (ctx: FunctionContext, message: string, ...args: any[]) => void | Promise<void>;
  //   warn: (ctx: FunctionContext, message: string, ...args: any[]) => void | Promise<void>;
  //   debug: (ctx: FunctionContext, message: string, ...args: any[]) => void | Promise<void>;
  //   error: (ctx: FunctionContext, message: string, ...args: any[]) => void | Promise<void>;
  // };
  store: TTLStore;
  query: (conId: string, query: string, params?: any) => Promise<any>;
  metrics?: FunctionMetrics;
  connectionOptions?: any;
};

type FunctionChain = {
  context: FunctionChainContext;
  connectionId: string;
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
// Supports files with format: ${workspaceId}__connections.json.gz
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

// Build function chain for a connection (UDF functions only)
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

  const chainCtx: FunctionChainContext = {
    store,
    query: async (conId: string, query: string, params: any) => {
      return warehouseQuery(connection.workspaceId, conEntityStore, conId, query, params, storeMetrics);
    },
    connectionOptions: connectionData,
  };

  return {
    context: chainCtx,
    connectionId: connection.id,
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

function safeCloseResponse(res: Response) {
  try {
    if (res?.body && !res.bodyUsed) {
      res.body.cancel?.();
    }
  } catch (_) {
    // ignore
  }
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
  connection: EnrichedConnectionConfig,
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

  // Prebuild function chains for all connections at startup (for non-free tier servers)
  // This ensures UDF compilation happens during startup rather than on first request
  const functionsClass = env.FUNCTIONS_CLASS;
  if (functionsClass && functionsClass !== "free" && connections.size > 0) {
    log
      .atInfo()
      .log(`Prebuilding function chains for ${connections.size} connections (functions class: ${functionsClass})...`);
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

  // Get or build chain for a connection (lazy loading with single-flight pattern)
  async function getOrBuildChain(connectionId: string): Promise<FunctionChain | undefined> {
    const connection = connections.get(connectionId);
    if (!connection) {
      return undefined;
    }

    const cached = chains.get(connectionId);
    if (cached) {
      return cached;
    }

    const buildPromise = buildFunctionChain(conEntityStore, connection, functions)
      .then(chain => {
        log.atInfo().log(`✓ Built chain for connection: ${connectionId} (${chain.functions.length} functions)`);
        return chain;
      })
      .catch(e => {
        log.atError().log(`✗ Failed to build chain for ${connectionId}: ${e.message}`);
        return undefined;
      });

    chains.set(connectionId, buildPromise);
    return buildPromise;
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

    // actorId = streamId of first connection (for metrics)
    const firstConnection = connections.get(connectionIds[0]);
    const actorId = firstConnection?.streamId || connectionIds[0] || "";

    const message = (await parseBody(req)) as IngestMessage;

    // Extract event from IngestMessage (handle classic format conversion)
    const event = message.httpPayload;

    // Ensure event has context
    if (!event.context) {
      event.context = {};
    }
    type StrictFuncChainResult = Required<FuncChainResultWithLogs>;

    // Process all connections in parallel
    const promises = connectionIds.map(async connectionId => {
      const connection = connections.get(connectionId);
      if (!connection) {
        log.atError().log(`[multi] Connection '${connectionId}' not found`);
        return {
          connectionId,
          execLog: [
            {
              error: { message: `Connection '${connectionId}' not found`, name: NoRetryErrorName },
              ms: 0,
              eventIndex: 0,
              functionId: "",
            },
          ],
          logs: [],
          events: [],
        } as StrictFuncChainResult;
      }

      const chain = await getOrBuildChain(connectionId);
      if (!chain) {
        log.atError().log(`[multi] Failed to build chain for connection '${connectionId}'`);
        return {
          connectionId,
          execLog: [
            {
              error: { message: "Internal Functions Error: please contact support", name: NoRetryErrorName },
              ms: 0,
              eventIndex: 0,
              functionId: "",
            },
          ],
          events: [],
          logs: [],
        } as StrictFuncChainResult;
      }

      // Create EventContext from IngestMessage (same as message-handler.ts)
      const eventContext = createEventContextFromMessage(message, connection, 0);
      const functionsFetchTimeout = req.headers["x-request-timeout-ms"]
        ? parseNumber(req.headers["x-request-timeout-ms"] as string, 2000)
        : parseNumber(env.FETCH_TIMEOUT_MS, 2000);
      try {
        const result = await runChain(chain, event, eventContext, functionsFetchTimeout);
        const totalMs = result.execLog.reduce((sum, e) => sum + (e.ms || 0), 0);
        log.atDebug().log(`← ${connectionId} (${chain.functions.length} functions) completed in ${totalMs}ms`);
        return result;
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
    const connection = connections.get(connectionId);
    if (!connection) {
      sendError(res, 404, `Connection '${connectionId}' not found`);
      return connectionId;
    }

    const chain = await getOrBuildChain(connectionId);
    if (!chain) {
      sendError(res, 500, `Failed to build chain for connection '${connectionId}'`);
      return connectionId;
    }

    if (req.method !== "POST") {
      sendError(res, 405, "Method not allowed. Use POST.");
      return connectionId;
    }

    const body = await parseBody(req);

    const event = body.event as AnyEvent;
    const eventContext = body.context as EventContext;

    // Parse receivedAt from string if needed (JSON serialization converts Date to string)
    if (eventContext?.receivedAt && typeof eventContext.receivedAt === "string") {
      eventContext.receivedAt = new Date(eventContext.receivedAt);
    }
    if (eventContext?.destination?.updatedAt && typeof eventContext.destination.updatedAt === "string") {
      eventContext.destination.updatedAt = new Date(eventContext.destination.updatedAt);
    }

    const functionsFetchTimeout = req.headers["x-request-timeout-ms"]
      ? parseNumber(req.headers["x-request-timeout-ms"] as string, 2000)
      : parseNumber(env.FETCH_TIMEOUT_MS, 2000);

    const result = await runChain(chain, event, eventContext, functionsFetchTimeout);
    recordChainResultMetrics(result);

    const totalMs = result.execLog.reduce((sum, e) => sum + (e.ms || 0), 0);
    log.atDebug().log(`← ${connectionId} (${chain.functions.length} functions) completed in ${totalMs}ms`);

    sendJson(res, 200, result);
    return connectionId;
  }

  // Create HTTP server
  let isShuttingDown = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // During shutdown, tell clients to close connections so they reconnect to healthy pods
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

      // Determine endpoint label for metrics
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
    }, forceExitTimeout).unref();

    // wait some seconds for connections to drain before shutting down metrics server
    const extraDelay = env.SHUTDOWN_EXTRA_DELAY_SEC ? 1000 * parseInt(env.SHUTDOWN_EXTRA_DELAY_SEC) : 5000;
    setTimeout(() => {
      // Stop accepting new connections
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
  log.atError().log("Fatal error:", e);
  process.exit(1);
});
