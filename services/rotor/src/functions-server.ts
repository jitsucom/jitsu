import http from "http";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
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
  AnonymousEventsStore,
  FunctionMetrics,
} from "@jitsu/protocols/functions";
import * as esbuild from "esbuild";

const gunzip = promisify(zlib.gunzip);
import { disableService, getLog, LogLevel, parseNumber, setServerJsonFormat, stopwatch } from "juava";
import {
  EnrichedConnectionConfig,
  FunctionConfig,
  isDropResult,
  FuncChainResult,
  FunctionExecRes,
  FunctionExecLog,
  makeFetch,
  EntityStore,
} from "@jitsu/core-functions-lib";
import { getServerEnv } from "./serverEnv";
import { DropRetryErrorName, NoRetryErrorName, NoRetryError, RetryError } from "@jitsu/functions-lib";
import { mongodb, createMongoStore } from "./lib/mongodb";
import { warehouseQuery } from "./lib/warehouse-store";
import { parse as semverParse } from "semver";
import * as jsondiffpatch from "jsondiffpatch";
import isEqual from "lodash/isEqual";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { parseUserAgent } from "@jitsu/core-functions-lib";

const env = getServerEnv();
const jsondiffpatchInstance = jsondiffpatch.create();

disableService("prisma");
disableService("pg");

setServerJsonFormat(env.LOG_FORMAT === "json");

const log = getLog("functions-server");

// Whitelist of packages that UDF code is allowed to import (will be bundled)
const ALLOWED_PACKAGES = ["@jitsu/functions-lib"];

// Node.js built-in modules (marked as external - available at runtime)
const NODE_BUILTINS = [
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "vm",
  "zlib",
];

// esbuild plugin to whitelist allowed imports
function createWhitelistPlugin(allowedPackages: string[]): esbuild.Plugin {
  return {
    name: "whitelist-imports",
    setup(build) {
      // Intercept all bare module imports (not relative/absolute paths)
      build.onResolve({ filter: /^[^./]/ }, args => {
        // Extract package name (handle scoped packages like @scope/package)
        const packageName = args.path.startsWith("@")
          ? args.path.split("/").slice(0, 2).join("/")
          : args.path.split("/")[0];

        // Allow whitelisted packages - let esbuild resolve and bundle them
        if (allowedPackages.includes(packageName)) {
          return null;
        }

        // Node built-ins - mark as external (available at runtime)
        if (NODE_BUILTINS.includes(packageName) || args.path.startsWith("node:")) {
          return { path: args.path, external: true };
        }

        // Everything else - error
        return {
          errors: [
            {
              text: `Import "${packageName}" is not allowed in UDF functions. Allowed packages: ${allowedPackages.join(
                ", "
              )}`,
            },
          ],
        };
      });
    },
  };
}

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

// Simple in-memory store implementation
function createMemoryStore(): TTLStore {
  const store = new Map<string, { value: any; expireAt?: number }>();

  return {
    async get(key: string): Promise<any> {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expireAt && Date.now() > entry.expireAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    async getWithTTL(key: string): Promise<{ value: any; ttl: number } | undefined> {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expireAt && Date.now() > entry.expireAt) {
        store.delete(key);
        return undefined;
      }
      const ttl = entry.expireAt ? Math.max(0, Math.floor((entry.expireAt - Date.now()) / 1000)) : -1;
      return { value: entry.value, ttl };
    },
    async set(key: string, value: any, opts?: number | string | { ttl: number }): Promise<void> {
      let ttlSeconds: number | undefined;
      if (typeof opts === "number") {
        ttlSeconds = opts;
      } else if (typeof opts === "string") {
        const match = opts.match(/^(\d+)([dhms])$/);
        if (match) {
          const num = parseInt(match[1]);
          const unit = match[2];
          switch (unit) {
            case "d":
              ttlSeconds = num * 86400;
              break;
            case "h":
              ttlSeconds = num * 3600;
              break;
            case "m":
              ttlSeconds = num * 60;
              break;
            case "s":
              ttlSeconds = num;
              break;
          }
        }
      } else if (opts && typeof opts === "object") {
        ttlSeconds = opts.ttl;
      }

      store.set(key, {
        value,
        expireAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
      });
    },
    async del(key: string): Promise<void> {
      store.delete(key);
    },
    async ttl(key: string): Promise<number> {
      const entry = store.get(key);
      if (!entry) return -2;
      if (!entry.expireAt) return -1;
      const ttl = Math.floor((entry.expireAt - Date.now()) / 1000);
      return ttl > 0 ? ttl : -2;
    },
  };
}

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
function createCollectingLogger(functionId: string, functionType: string, logEntries: LogEntry[]) {
  const addEntry = (level: LogEntry["level"], message: string, args: any[]) => {
    logEntries.push({
      level,
      functionId,
      functionType,
      message,
      args: args.length > 0 ? args : undefined,
      timestamp: new Date(),
    });
    // Also log to console
    const logFn =
      level === "error"
        ? log.atError()
        : level === "warn"
        ? log.atWarn()
        : level === "debug"
        ? log.atDebug()
        : log.atInfo();
    logFn.log(`[${functionId}] ${message}`, ...args);
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

// Preamble code to set up globals for backward compatibility with web interface UDFs
// These globals are available without explicit imports
const UDF_GLOBALS_PREAMBLE = `
import {
  RetryError as _RetryError,
  NoRetryError as _NoRetryError,
  TableNameParameter as _TableNameParameter,
  toJitsuClassic as _toJitsuClassic,
  fromJitsuClassic as _fromJitsuClassic,
} from "@jitsu/functions-lib";
globalThis.RetryError = _RetryError;
globalThis.NoRetryError = _NoRetryError;
globalThis.TableNameParameter = _TableNameParameter;
globalThis.toJitsuClassic = _toJitsuClassic;
globalThis.fromJitsuClassic = _fromJitsuClassic;
`;

// Directory for compiled UDF files (for readable stack traces)
const UDF_TEMP_DIR = path.join(os.tmpdir(), "jitsu-udf");

// Ensure UDF temp directory exists
async function ensureUdfTempDir(): Promise<void> {
  try {
    await fsp.access(UDF_TEMP_DIR);
  } catch {
    await fsp.mkdir(UDF_TEMP_DIR, { recursive: true });
  }
}

// Sanitize function ID for use in filename
function sanitizeFunctionId(functionId: string): string {
  return functionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Compile UDF function from code string using esbuild
async function compileUdfFunction(connectionId: string, code: string, functionId: string, env: any): Promise<any> {
  try {
    const envs = `
    const process = { env: ${JSON.stringify(env || {})}}
    `;
    // Prepend globals preamble to user code so it gets bundled together
    const fullCode = UDF_GLOBALS_PREAMBLE + envs + code;

    const result = await esbuild.build({
      stdin: {
        contents: fullCode,
        loader: "js",
        resolveDir: process.cwd(), // Needed for resolving node_modules
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      target: "node20",
      plugins: [createWhitelistPlugin(ALLOWED_PACKAGES)],
      logLevel: "silent", // We'll handle errors ourselves
    });

    if (result.errors.length > 0) {
      const errorMessages = result.errors.map(e => e.text).join("\n");
      throw new Error(`Failed to compile function ${functionId}:\n${errorMessages}`);
    }

    // Write to temp file for readable stack traces
    await ensureUdfTempDir();
    const sanitizedId = sanitizeFunctionId(connectionId + "-" + functionId);
    const tempFile = path.join(UDF_TEMP_DIR, `${sanitizedId}.mjs`);
    const bundledCode = result.outputFiles[0].text;
    await fsp.writeFile(tempFile, bundledCode);

    // Import from file path (gives readable stack traces)
    const module = await import(tempFile);

    const func = module.default;
    if (typeof func !== "function") {
      throw new Error(
        `Default export from function ${functionId} is not a function: ${typeof module.default} module: ${JSON.stringify(
          module
        )}`
      );
    }
    return module;
  } catch (e: any) {
    // Handle esbuild build failures (e.g., syntax errors)
    if (e.errors && Array.isArray(e.errors)) {
      const errorMessages = e.errors.map((err: any) => err.text).join("\n");
      throw new Error(`Failed to compile function ${functionId}:\n${errorMessages}`);
    }
    throw e;
  }
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
        log.atInfo().log(`✓ Loaded connection: ${config.id}`);
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
        log.atInfo().log(`  ✓ Compiled UDF: ${functionId}`);
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
        log.atInfo().log(`  ⚠ Added error-throwing placeholder for UDF: ${functionId}`);
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
      log.atInfo().log(`  ⚠ Added error-throwing placeholder for missing UDF: ${functionId}`);
    }
  }
  // Create shared store - use MongoDB if MONGODB_URL is provided, otherwise fall back to in-memory
  let store: TTLStore;
  if (env.MONGODB_URL) {
    store = createMongoStore(connection.workspaceId, mongodb, false, true);
  } else {
    log.atInfo().log(`Using in-memory store (MONGODB_URL not set)`);
    store = createMemoryStore();
  }

  const chainCtx: FunctionChainContext = {
    store,
    query: async (conId: string, query: string, params: any) => {
      return warehouseQuery(connection.workspaceId, conEntityStore, conId, query, params);
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

// Run function chain
async function runChain(
  chain: FunctionChain,
  event: AnyEvent,
  eventContext: EventContext,
  fetchTimeoutMs: number = 2000
): Promise<FuncChainResultWithLogs> {
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

      const fetchResponses: Response[] = [];
      try {
        // Get retries from eventContext (passed from rotor)
        const retries = (eventContext as EventContext & { retries?: number }).retries ?? 0;
        const fullContext: FullContext = {
          ...eventContext,
          log: createCollectingLogger(id, functionType, logs),
          fetch: makeFetch(
            chain.connectionId,
            {
              log(connectionId: string, level: LogLevel, msg: Record<string, any>) {
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
            chainCtx.connectionOptions.fetchLogLevel || "info",
            fetchTimeoutMs,
            fetchResponses
          ),
          store: chainCtx.store,
          props: chainCtx.connectionOptions.functionsEnv || {},
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
        console.log(`Function ${func.id} execution error: ${JSON.stringify(func.config)}`);
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
      } finally {
        // Close fetch responses
        for (const resp of fetchResponses) {
          try {
            resp.body?.cancel();
          } catch {}
        }
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

  return { events, execLog, logs };
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

// Create event context from request and connection
function createEventContext(req: http.IncomingMessage, connection: EnrichedConnectionConfig): EventContext {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers[key] = value;
    } else if (Array.isArray(value)) {
      headers[key] = value.join(", ");
    }
  }

  return {
    headers,
    source: {
      id: connection.streamId,
      name: connection.streamName,
      type: "s2s",
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
    receivedAt: new Date(),
  };
}

// Create event context from IngestMessage and connection (compatible with FunctionsHandlerMulti)
function createEventContextFromMessage(
  message: IngestMessage,
  connection: EnrichedConnectionConfig,
  retries: number = 0
): EventContext & { retries: number } {
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
    await mongodb.waitInit();
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
    const prebuildPromises: Promise<void>[] = [];

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
  async function handleMulti(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    if (req.method !== "POST") {
      sendError(res, 405, "Method not allowed. Use POST.");
      return;
    }

    const connectionIds = (url.searchParams.get("ids") ?? "").split(",").filter(id => !!id);
    const fullEvents = url.searchParams.get("fullEvents") === "true";

    if (connectionIds.length === 0) {
      sendError(res, 400, "No connection IDs provided. Use ?ids=conn1,conn2,...");
      return;
    }

    const message = (await parseBody(req)) as IngestMessage;

    // Extract event from IngestMessage (handle classic format conversion)
    const event = message.httpPayload;

    // Ensure event has context
    if (!event.context) {
      event.context = {};
    }

    // Process all connections in parallel
    const promises = connectionIds.map(async connectionId => {
      const connection = connections.get(connectionId);
      if (!connection) {
        log.atWarn().log(`[multi] Connection '${connectionId}' not found`);
        return {
          connectionId,
          execLog: [{ error: { message: `Connection '${connectionId}' not found`, name: "Connection Not Found" } }],
          events: [],
        };
      }

      const chain = await getOrBuildChain(connectionId);
      if (!chain) {
        log.atError().log(`[multi] Failed to build chain for connection '${connectionId}'`);
        return {
          connectionId,
          execLog: [{ error: { message: "Internal Functions Error: please contact support", name: "Internal Error" } }],
          events: [],
        };
      }

      // Create EventContext from IngestMessage (same as message-handler.ts)
      const eventContext = createEventContextFromMessage(message, connection, 0);
      const functionsFetchTimeout = req.headers["x-request-timeout-ms"]
        ? parseNumber(req.headers["x-request-timeout-ms"] as string, 2000)
        : parseNumber(env.FETCH_TIMEOUT_MS, 2000);
      try {
        const result = await runChain(chain, event, eventContext, functionsFetchTimeout);

        const totalMs = result.execLog.reduce((sum, e) => sum + (e.ms || 0), 0);
        log.atInfo().log(`← ${connectionId} (${chain.functions.length} functions) completed in ${totalMs}ms`);

        return { connectionId, events: result.events, execLog: result.execLog, logs: result.logs };
      } catch (e: any) {
        log.atError().log(`[multi] Error processing connection ${connectionId}: ${e.message}`);
        return {
          connectionId,
          execLog: [{ error: { message: e.message, name: e.name } }],
          events: [],
        };
      }
    });

    const results = await Promise.all(promises);

    // Build response with events and execLog
    // Map connectionId -> { events, execLog }
    const response = Object.fromEntries(
      results.map(result => [
        result.connectionId,
        {
          events: fullEvents ? result.events || [] : mapDiff(message.httpPayload, result.events),
          execLog: result.execLog,
          logs: result.logs || [],
        },
      ])
    );

    sendJson(res, 200, response);
  }

  // Single connection handler: POST /connection/<connection-id>
  async function handleConnection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    connectionId: string
  ): Promise<void> {
    const connection = connections.get(connectionId);
    if (!connection) {
      sendError(res, 404, `Connection '${connectionId}' not found`);
      return;
    }

    const chain = await getOrBuildChain(connectionId);
    if (!chain) {
      sendError(res, 500, `Failed to build chain for connection '${connectionId}'`);
      return;
    }

    if (req.method !== "POST") {
      sendError(res, 405, "Method not allowed. Use POST.");
      return;
    }

    const body = await parseBody(req);

    let event: AnyEvent;
    let customContext: Partial<EventContext> = {};

    if (body.event && typeof body.event === "object") {
      event = body.event;
      if (body.context) {
        customContext = body.context;
      }
    } else {
      event = body;
    }

    // Parse receivedAt from string if needed (JSON serialization converts Date to string)
    if (customContext.receivedAt && typeof customContext.receivedAt === "string") {
      customContext.receivedAt = new Date(customContext.receivedAt);
    }

    const eventContext: EventContext = {
      ...createEventContext(req, connection),
      ...customContext,
    } as EventContext & { retries?: number };

    const functionsFetchTimeout = req.headers["x-request-timeout-ms"]
      ? parseNumber(req.headers["x-request-timeout-ms"] as string, 2000)
      : parseNumber(env.FETCH_TIMEOUT_MS, 2000);

    const result = await runChain(chain, event, eventContext, functionsFetchTimeout);

    const totalMs = result.execLog.reduce((sum, e) => sum + (e.ms || 0), 0);
    log.atInfo().log(`← ${connectionId} (${chain.functions.length} functions) completed in ${totalMs}ms`);

    sendJson(res, 200, result);
  }

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

      // Multi connection handler
      if (pathname === "/multi") {
        await handleMulti(req, res, url);
        return;
      }

      // Single connection handler
      const match = pathname.match(/^\/connection\/([^\/]+)$/);
      if (match) {
        await handleConnection(req, res, match[1]);
        return;
      }

      // Not found
      sendError(res, 404, "Not found. Use /connection/<connection-id> or /multi?ids=conn1,conn2,...");
    } catch (e: any) {
      log.atError().log(`Error processing request:`, e);
      sendError(res, 500, e.message);
    }
  });

  server.listen(port, () => {
    log.atInfo().log(`Server running at http://localhost:${port}`);
    log.atInfo().log(`Config directory: ${configDir}`);
    log.atInfo().log(`Available connections: ${connections.size} (chains built lazily on first request):`);
  });

  // Graceful shutdown handler
  let isShuttingDown = false;

  const shutdown = (signal: string) => {
    if (isShuttingDown) {
      log.atInfo().log(`Already shutting down, ignoring ${signal}`);
      return;
    }
    isShuttingDown = true;
    log.atInfo().log(`Received ${signal}, starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(err => {
      if (err) {
        log.atError().log(`Error during server close:`, err);
        process.exit(1);
      }
      log.atInfo().log(`Server closed, all connections drained`);
      process.exit(0);
    });

    // Force exit after timeout if connections don't drain
    const forceExitTimeout = 30000; // 30 seconds
    setTimeout(() => {
      log.atWarn().log(`Forcing exit after ${forceExitTimeout}ms timeout`);
      process.exit(1);
    }, forceExitTimeout).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(e => {
  log.atError().log("Fatal error:", e);
  process.exit(1);
});
