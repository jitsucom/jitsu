import http from "http";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import { promisify } from "util";
import { AnyEvent, EventContext, FuncReturn, FullContext, JitsuFunction, TTLStore } from "@jitsu/protocols/functions";

const gunzip = promisify(zlib.gunzip);
import { getLog, stopwatch } from "juava";
import {
  EnrichedConnectionConfig,
  FunctionConfig,
  isDropResult,
  FuncChainResult,
  FunctionExecRes,
  FunctionExecLog,
  storeFunc,
} from "@jitsu/core-functions-lib";
import { getServerEnv } from "./serverEnv";

const log = getLog("functions-server");

// Types
type LoadedFunction = {
  id: string;
  exec: JitsuFunction;
  config?: Record<string, any>;
};

type FunctionChain = {
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
  message: string;
  args?: any[];
  timestamp: Date;
};

// Collecting function logger - stores logs and also outputs to console
function createCollectingLogger(functionId: string, logEntries: LogEntry[]) {
  const addEntry = (level: LogEntry["level"], message: string, args: any[]) => {
    logEntries.push({
      level,
      functionId,
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

// Compile UDF function from code string
async function compileUdfFunction(code: string, functionId: string): Promise<JitsuFunction> {
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const module = await import(dataUrl);
  const func = module.default;
  if (typeof func !== "function") {
    throw new Error(`Default export from function ${functionId} is not a function`);
  }
  return func;
}

// Check if file is a JSON config file (.json or .json.gz)
function isJsonConfigFile(filename: string): boolean {
  return filename.endsWith(".json") || filename.endsWith(".json.gz");
}

// Load function configs from a directory
async function loadFunctionsFromDir(dir: string, functions: Map<string, FunctionConfig>): Promise<void> {
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir)) {
    if (!isJsonConfigFile(file)) continue;
    try {
      const config = await loadJsonFile<FunctionConfig>(path.join(dir, file));
      functions.set(config.id, config);
      const compressed = file.endsWith(".gz") ? " (compressed)" : "";
      log.atInfo().log(`✓ Loaded function: ${config.id} (${config.name})${compressed}`);
    } catch (e: any) {
      log.atError().log(`✗ Failed to load function ${file}: ${e.message}`);
    }
  }
}

// Load configs from filesystem
async function loadConfigsFromFiles(configDir: string): Promise<{
  connections: Map<string, EnrichedConnectionConfig>;
  functions: Map<string, FunctionConfig>;
}> {
  const connections = new Map<string, EnrichedConnectionConfig>();
  const functions = new Map<string, FunctionConfig>();

  const connectionsDir = path.join(configDir, "connections");
  const functionsDir = path.join(configDir, "functions");

  // Load connection configs
  if (fs.existsSync(connectionsDir)) {
    for (const file of fs.readdirSync(connectionsDir)) {
      if (!isJsonConfigFile(file)) continue;
      try {
        const config = await loadJsonFile<EnrichedConnectionConfig>(path.join(connectionsDir, file));
        connections.set(config.id, config);
        log.atInfo().log(`✓ Loaded connection: ${config.id}`);
      } catch (e: any) {
        log.atError().log(`✗ Failed to load connection ${file}: ${e.message}`);
      }
    }
  }

  // Load function configs from main functions directory
  await loadFunctionsFromDir(functionsDir, functions);

  // Also check for partitioned function directories (functions/part-0, functions/part-1, etc.)
  if (fs.existsSync(functionsDir)) {
    for (const entry of fs.readdirSync(functionsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("part-")) {
        const partDir = path.join(functionsDir, entry.name);
        log.atInfo().log(`Loading functions from partition: ${entry.name}`);
        await loadFunctionsFromDir(partDir, functions);
      }
    }
  }

  return { connections, functions };
}

// Save repository data to filesystem
function saveToFiles(
  configDir: string,
  connections: Map<string, EnrichedConnectionConfig>,
  functions: Map<string, FunctionConfig>
) {
  const connectionsDir = path.join(configDir, "connections");
  const functionsDir = path.join(configDir, "functions");

  fs.mkdirSync(connectionsDir, { recursive: true });
  fs.mkdirSync(functionsDir, { recursive: true });

  for (const [id, config] of connections) {
    const filePath = path.join(connectionsDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  }

  for (const [id, config] of functions) {
    const filePath = path.join(functionsDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  }
}

// Build function chain for a connection (UDF functions only)
async function buildFunctionChain(
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
        const udfFunc = await compileUdfFunction(funcConfig.code, functionId);
        funcs.push({
          id: f.functionId,
          exec: udfFunc,
          config: connectionData.functionsEnv || {},
        });
        log.atInfo().log(`  ✓ Compiled UDF: ${functionId}`);
      } catch (e: any) {
        log.atError().log(`  ✗ Failed to compile UDF ${functionId}: ${e.message}`);
      }
    } else {
      log.atWarn().log(`UDF not found or has no code: ${functionId}`);
    }
  }

  return {
    connectionId: connection.id,
    functions: funcs,
  };
}

// Extended result type with logs
type FuncChainResultWithLogs = FuncChainResult & {
  logs: LogEntry[];
};

// Run function chain
async function runChain(
  chain: FunctionChain,
  event: AnyEvent,
  eventContext: EventContext,
  store: TTLStore
): Promise<FuncChainResultWithLogs> {
  const execLog: FunctionExecLog = [];
  const logs: LogEntry[] = [];
  let events: AnyEvent[] = [event];

  for (const func of chain.functions) {
    const newEvents: AnyEvent[] = [];

    for (let i = 0; i < events.length; i++) {
      const currentEvent = events[i];
      const sw = stopwatch();
      let result: FuncReturn;
      let error: any;

      const execLogEntry: Partial<FunctionExecRes> = {
        eventIndex: i,
        receivedAt: eventContext.receivedAt,
        functionId: func.id,
      };

      try {
        const fullContext: FullContext = {
          ...eventContext,
          log: createCollectingLogger(func.id, logs),
          fetch: fetch,
          store,
          props: func.config || {},
          getWarehouse: () => {
            throw new Error("Warehouse API is not available in functions-server");
          },
        };

        result = await func.exec(currentEvent, fullContext);
      } catch (e: any) {
        error = e;
        execLogEntry.error = e;
        log.atError().log(`Function ${func.id} error:`, e);
      }

      execLogEntry.ms = sw.elapsedMs();
      execLogEntry.dropped = isDropResult(result);
      execLog.push(execLogEntry as FunctionExecRes);

      if (!execLogEntry.dropped && !error) {
        if (result === null || result === undefined) {
          newEvents.push(currentEvent);
        } else if (Array.isArray(result)) {
          newEvents.push(...result);
        } else if (typeof result === "object") {
          newEvents.push(result as AnyEvent);
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

async function main() {
  const env = getServerEnv();
  const port = parseInt(env.PORT);
  const configDir = path.resolve(env.CONFIG_DIR);

  // Initialize files from repository if INIT_FILES is set
  if (env.INIT_FILES) {
    if (!env.REPOSITORY_BASE_URL) {
      log.atError().log("REPOSITORY_BASE_URL is required when INIT_FILES=true");
      process.exit(1);
    }

    log.atInfo().log(`Initializing files from repository: ${env.REPOSITORY_BASE_URL}`);

    // Initialize repository stores
    const connectionsStore = storeFunc<EnrichedConnectionConfig>("rotor-connections", true);
    const functionsStore = storeFunc<FunctionConfig>("functions", true);

    // Wait for initial load
    const [connStore, funcStore] = await Promise.all([connectionsStore.get(), functionsStore.get()]);

    // Save to filesystem
    const connections = new Map<string, EnrichedConnectionConfig>();
    const functions = new Map<string, FunctionConfig>();

    for (const [id, config] of Object.entries(connStore.getAll())) {
      connections.set(id, config);
      log.atInfo().log(`✓ Fetched connection: ${id}`);
    }

    for (const [id, config] of Object.entries(funcStore.getAll())) {
      functions.set(id, config);
      log.atInfo().log(`✓ Fetched function: ${id} (${config.name})`);
    }

    saveToFiles(configDir, connections, functions);
    log.atInfo().log(`Saved ${connections.size} connections and ${functions.size} functions to ${configDir}`);
  }

  // Load configs from files
  log.atInfo().log(`Loading configs from files: ${configDir}`);

  let { connections, functions } = await loadConfigsFromFiles(configDir);

  // Reload function re-reads files
  const reloadFn = async () => {
    const loaded = await loadConfigsFromFiles(configDir);
    connections = loaded.connections;
    functions = loaded.functions;
  };

  if (connections.size === 0) {
    log.atWarn().log("No connections found");
  }

  // Build function chains for all connections
  let chains = new Map<string, FunctionChain>();

  async function rebuildChains() {
    chains = new Map();
    for (const [id, connection] of connections) {
      try {
        const chain = await buildFunctionChain(connection, functions);
        chains.set(id, chain);
        log.atInfo().log(`✓ Built chain for connection: ${id} (${chain.functions.length} functions)`);
      } catch (e: any) {
        log.atError().log(`✗ Failed to build chain for ${id}: ${e.message}`);
      }
    }
  }

  await rebuildChains();

  // Create shared store
  const store = createMemoryStore();

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

    // Health check
    if (pathname === "/health" || pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          configDir,
          connections: Array.from(connections.keys()),
          chains: Array.from(chains.keys()),
        })
      );
      return;
    }

    // Reload configs
    if (pathname === "/_reload") {
      log.atInfo().log("Reloading configs...");
      try {
        await reloadFn();
        await rebuildChains();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            connections: Array.from(connections.keys()),
            chains: Array.from(chains.keys()),
          })
        );
      } catch (e: any) {
        log.atError().log(`Reload failed: ${e.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // Execute chain: /connection/<connection-id>
    const match = pathname.match(/^\/connection\/([^\/]+)$/);
    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. Use /connection/<connection-id>" }));
      return;
    }

    const connectionId = match[1];
    const connection = connections.get(connectionId);
    const chain = chains.get(connectionId);

    if (!connection || !chain) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Connection '${connectionId}' not found`,
          available: Array.from(connections.keys()),
        })
      );
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed. Use POST." }));
      return;
    }

    try {
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

      const eventContext: EventContext = {
        ...createEventContext(req, connection),
        ...customContext,
      };

      log.atInfo().log(`→ ${connectionId} processing event (${chain.functions.length} functions)`);

      const result = await runChain(chain, event, eventContext, store);

      const totalMs = result.execLog.reduce((sum, e) => sum + (e.ms || 0), 0);
      log.atInfo().log(`← ${connectionId} completed in ${totalMs}ms`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    } catch (e: any) {
      log.atError().log(`Error processing request:`, e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  server.listen(port, () => {
    log.atInfo().log(`\nServer running at http://localhost:${port}`);
    log.atInfo().log(`Config directory: ${configDir}`);
    log.atInfo().log(`\nEndpoints:`);
    log.atInfo().log(`  GET  /           - Health check & list connections`);
    log.atInfo().log(`  GET  /_reload    - Reload configs`);
    for (const id of chains.keys()) {
      const chain = chains.get(id)!;
      log.atInfo().log(`  POST /connection/${id} - Execute chain (${chain.functions.length} funcs)`);
    }
  });
}

main().catch(e => {
  log.atError().log("Fatal error:", e);
  process.exit(1);
});
