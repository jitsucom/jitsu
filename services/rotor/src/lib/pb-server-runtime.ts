/**
 * Profile Builder runtime for the functions-server (Deno).
 * Handles loading profile builder configs, MongoDB connections,
 * and executing profile UDF chains.
 */
import path from "path";
import fs from "fs";
import zlib from "zlib";
import { promisify } from "util";
import { getLog, int32Hash, parseNumber, stopwatch } from "juava";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { ProfileResult } from "@jitsu/protocols/profile";
import { buildEventsIterable } from "./profile-utils";
import {
  createMemoryStore,
  EnrichedConnectionConfig,
  EntityStore,
  FunctionChainContext,
  FunctionConfig,
  makeFetch,
  makeLog,
  StoreMetrics,
} from "@jitsu/core-functions-lib";
import type { TTLStore } from "@jitsu/protocols/functions";
import { createMongoStore, mongodb } from "./mongodb";
import { compileUdfFunction } from "./udf-shared";
import { warehouseQuery } from "./warehouse-store";
import { getServerEnv } from "../serverEnv";

const gunzip = promisify(zlib.gunzip);
const log = getLog("pb-server-runtime");
const serverEnv = getServerEnv();

// Profile builder config as stored in ConfigMap
export type ProfileBuilderConfig = {
  id: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  version: number;
  destinationId: string;
  connectionOptions: any;
  intermediateStorageCredentials: any;
  functions: FunctionConfig[];
  debugTill?: string;
};

export type ProfileUser = {
  profileId: string;
  userId: string;
  anonymousId: string;
  traits: Record<string, any>;
};

export type Profile = {
  profile_id: string;
  destination_id?: string;
  table_name?: string;
  traits: Record<string, any>;
  version?: number;
  updated_at: Date;
};

type ProfileChainResult = {
  result?: Profile;
  logs: Array<{
    level: string;
    functionId: string;
    functionType: string;
    message: any;
    args?: any[];
    timestamp: Date;
  }>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
};

export type CompiledProfileBuilder = {
  config: ProfileBuilderConfig;
  udfFunctions: Array<{ id: string; exec: (events: any, user: any, ctx: any) => Promise<ProfileResult | undefined> }>;
  mongoClient: any; // MongoClient from mongodb driver
  store: TTLStore;
};

const profileIdHashColumn = "_profile_id_hash";
const profileIdColumn = "_profile_id";

// MongoDB clients cache (keyed by mongoUrl hash)
const mongoClients = new Map<string, any>();

async function getOrCreateMongoClient(mongoUrl: string): Promise<any> {
  // Dynamic import for mongodb (available in Deno via npm:)
  const { MongoClient } = await import("mongodb");

  const key = mongoUrl;
  let client = mongoClients.get(key);
  if (client) {
    return client;
  }
  const mongoTimeout = parseNumber(serverEnv.PB_MONGODB_TIMEOUT_MS || serverEnv.MONGODB_TIMEOUT_MS, 1000);
  client = new MongoClient(mongoUrl, {
    compressors: ["zstd"],
    serverSelectionTimeoutMS: 60000,
    maxPoolSize: 32,
    connectTimeoutMS: 60000,
    socketTimeoutMS: mongoTimeout,
  });
  await client.connect();
  await client.db().command({ ping: 1 });
  mongoClients.set(key, client);

  return client;
}

// Load profile builder configs from /data/profilebuilders/part-{n}/
export async function loadProfileBuilders(configDir: string): Promise<Map<string, ProfileBuilderConfig>> {
  const profileBuilders = new Map<string, ProfileBuilderConfig>();
  const pbDir = path.join(configDir, "profilebuilders");

  if (!fs.existsSync(pbDir)) {
    return profileBuilders;
  }

  async function loadFromDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json") && !file.endsWith(".json.gz")) continue;
      try {
        let content: string;
        if (file.endsWith(".gz")) {
          const compressed = fs.readFileSync(path.join(dir, file));
          const decompressed = await gunzip(compressed);
          content = decompressed.toString("utf-8");
        } else {
          content = fs.readFileSync(path.join(dir, file), "utf-8");
        }
        const pb = JSON.parse(content) as ProfileBuilderConfig;
        profileBuilders.set(pb.id, pb);
        log.atInfo().log(`Loaded profile builder: ${pb.id} (workspace: ${pb.workspaceId}, v${pb.version})`);
      } catch (e: any) {
        log.atError().log(`Failed to load profile builder from ${file}: ${e.message}`);
      }
    }
  }

  // Load from main directory
  await loadFromDir(pbDir);

  // Load from partitioned directories
  for (const entry of fs.readdirSync(pbDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("part-")) {
      await loadFromDir(path.join(pbDir, entry.name));
    }
  }

  return profileBuilders;
}

// Compile and initialize profile builders
export async function initProfileBuilderRuntimes(
  profileBuilders: Map<string, ProfileBuilderConfig>,
  deploymentId: string,
  storeMetrics: StoreMetrics
): Promise<Map<string, CompiledProfileBuilder>> {
  const compiled = new Map<string, CompiledProfileBuilder>();

  for (const [pbId, pb] of profileBuilders) {
    try {
      const udfFunctions: CompiledProfileBuilder["udfFunctions"] = [];

      for (const fn of pb.functions) {
        if (!fn.code) {
          log.atWarn().log(`Profile builder ${pbId}: function ${fn.id} has no code, skipping`);
          continue;
        }
        try {
          const compiledFn = await compileUdfFunction(pbId, fn.code, fn.id, pb.connectionOptions?.variables);
          udfFunctions.push({ id: fn.id, exec: compiledFn.default });
          log.atInfo().log(`  ✓ Compiled profile UDF: ${fn.id} for builder ${pbId}`);
        } catch (e: any) {
          log.atError().log(`  ✗ Failed to compile profile UDF ${fn.id}: ${e.message}`);
          udfFunctions.push({
            id: fn.id,
            exec: async () => {
              throw new Error(`Compilation error: ${e.message}`);
            },
          });
        }
      }

      // Get MongoDB client for this profile builder
      let mongoClient: any;
      const mongoUrl = pb.intermediateStorageCredentials?.mongoUrl || serverEnv.MONGODB_URL;
      if (mongoUrl) {
        mongoClient = await getOrCreateMongoClient(mongoUrl);
      }

      // Initialize the persistent store once — reused across all runs of this profile builder
      const store: TTLStore = serverEnv.MONGODB_URL
        ? createMongoStore(pb.workspaceId, mongodb, false, true, storeMetrics)
        : createMemoryStore({});

      compiled.set(pbId, { config: pb, udfFunctions, mongoClient, store });
      log.atInfo().log(`✓ Initialized profile builder: ${pbId} (${udfFunctions.length} functions)`);
    } catch (e: any) {
      log.atError().log(`✗ Failed to initialize profile builder ${pbId}: ${e.message}`);
    }
  }

  return compiled;
}

// Pre-load all profile events from MongoDB into an array. UDF expects sync iteration
// (`for (const e of events)`), so we drain the cursor up-front.
async function getProfileEvents(
  mongoClient: any,
  eventsDatabase: string,
  eventsCollectionName: string,
  profileId: string
): Promise<AnalyticsServerEvent[]> {
  const { ReadPreference } = await import("mongodb");
  const docs = (await mongoClient
    .db(eventsDatabase)
    .collection(eventsCollectionName)
    .find(
      {
        [profileIdHashColumn]: int32Hash(profileId),
        [profileIdColumn]: profileId,
      },
      { readPreference: ReadPreference.NEAREST }
    )
    .toArray()) as AnalyticsServerEvent[];
  for (const d of docs) {
    if ((d as any).timestamp instanceof Date) {
      (d as any).timestamp = (d as any).timestamp.toISOString();
    }
  }
  return docs;
}

// Query user traits from MongoDB
async function getProfileUser(
  mongoClient: any,
  eventsDatabase: string,
  traitsCollectionName: string,
  profileId: string
): Promise<ProfileUser> {
  const { ReadPreference } = await import("mongodb");
  const u = await mongoClient
    .db(eventsDatabase)
    .collection(traitsCollectionName)
    .findOne({ [profileIdColumn]: profileId }, { readPreference: ReadPreference.NEAREST });

  if (!u) {
    return { profileId, userId: "", anonymousId: "", traits: {} };
  }
  return {
    profileId,
    userId: u.userId || "",
    anonymousId: u.anonymousId || "",
    traits: u.traits || {},
  };
}

// Execute profile builder chain for a given profileId
export async function runProfileBuilder(
  compiledPb: CompiledProfileBuilder,
  profileId: string,
  deploymentId: string,
  storeMetrics: StoreMetrics,
  conEntityStore?: EntityStore<EnrichedConnectionConfig>
): Promise<ProfileChainResult> {
  const pb = compiledPb.config;
  const sw = stopwatch();
  const logs: ProfileChainResult["logs"] = [];

  const eventsDatabase = "profiles";
  const eventsCollectionName = `profiles-raw-${pb.workspaceId}-${pb.id}`;
  const traitsCollectionName = `profiles-traits-${pb.workspaceId}-${pb.id}`;

  try {
    if (!compiledPb.mongoClient) {
      throw new Error(`No MongoDB connection for profile builder ${pb.id}`);
    }

    // Pre-load events and user in parallel
    const [events, user] = await Promise.all([
      getProfileEvents(compiledPb.mongoClient, eventsDatabase, eventsCollectionName, profileId),
      getProfileUser(compiledPb.mongoClient, eventsDatabase, traitsCollectionName, profileId),
    ]);
    const eventsIterable = buildEventsIterable(events);

    // EventsStore adapter that pushes HTTP request logs (and any other) into the logs array
    const collectingEventsStore = {
      log: (connectionId: string, level: any, msg: Record<string, any>) => {
        logs.push({
          level,
          functionId: pb.id,
          functionType: "profile",
          message: { ...msg, functionId: pb.id, functionType: "profile" },
          timestamp: new Date(),
        });
      },
      close: () => {},
      deadLetter: () => {},
    };
    const fetchTimeout = parseNumber(serverEnv.FETCH_TIMEOUT_MS, 2000);

    const funcCtx = {
      function: {
        id: pb.id,
        type: "profile",
        debugTill: pb.debugTill ? new Date(pb.debugTill) : undefined,
      },
      props: pb.connectionOptions?.variables || {},
      log: {
        info: (message: string, ...args: any[]) =>
          logs.push({
            message,
            level: "info",
            timestamp: new Date(),
            functionId: pb.id,
            functionType: "profile",
            args: args.length > 0 ? args : undefined,
          }),
        warn: (message: string, ...args: any[]) =>
          logs.push({
            message,
            level: "warn",
            timestamp: new Date(),
            functionId: pb.id,
            functionType: "profile",
            args: args.length > 0 ? args : undefined,
          }),
        debug: (message: string, ...args: any[]) =>
          logs.push({
            message,
            level: "debug",
            timestamp: new Date(),
            functionId: pb.id,
            functionType: "profile",
            args: args.length > 0 ? args : undefined,
          }),
        error: (message: string, ...args: any[]) =>
          logs.push({
            message,
            level: "error",
            timestamp: new Date(),
            functionId: pb.id,
            functionType: "profile",
            args: args.length > 0 ? args : undefined,
          }),
      },
      fetch: makeFetch(pb.id, collectingEventsStore, "info", fetchTimeout),
      store: compiledPb.store,
      getWarehouse: (destinationId: string) => ({
        query: async (sql: string, params?: Record<string, any>) => {
          if (!conEntityStore) {
            throw new Error("Warehouse queries not available: no connection store configured");
          }
          const pbWarehouseTimeout = parseNumber(
            serverEnv.PB_WAREHOUSE_TIMEOUT_MS || serverEnv.WAREHOUSE_TIMEOUT_MS,
            1000
          );
          return warehouseQuery(
            pb.workspaceId,
            conEntityStore,
            destinationId,
            sql,
            params || {},
            storeMetrics,
            pbWarehouseTimeout
          );
        },
      }),
      profileBuilder: {
        id: pb.id,
        version: pb.version,
      },
    };

    // Run UDF chain - each function in sequence
    let result: ProfileResult | undefined;
    const udf = compiledPb.udfFunctions[0];
    try {
      result = await udf.exec(eventsIterable, user, funcCtx);
    } catch (e: any) {
      return {
        logs,
        error: {
          name: e.name || "Error",
          message: e.message || "Profile function execution failed",
          stack: e.stack,
        },
      };
    }

    if (!result) {
      return { logs };
    }

    // Build final Profile — accept both camelCase and snake_case keys (matches legacy pb-functions-chain.ts)
    const r = result as any;
    const profile: Profile = {
      profile_id: r.profileId || r.profile_id || profileId,
      destination_id: r.destinationId || r.destination_id || pb.destinationId,
      table_name: r.tableName || r.table_name || pb.connectionOptions?.tableName || "profiles",
      traits: { ...user.traits, ...r.traits },
      version: pb.version,
      updated_at: new Date(),
    };

    return { result: profile, logs };
  } catch (e: any) {
    return {
      logs,
      error: {
        name: e.name || "Error",
        message: e.message || "Profile builder execution failed",
        stack: e.stack,
      },
    };
  }
}

// Profile UDF test request/response types
export type ProfileUDFTestRequest = {
  id: string;
  name: string;
  version: number;
  code: string;
  events: AnalyticsServerEvent[];
  settings: {
    variables: any;
    destinationId: string;
    tableName?: string;
    [key: string]: any;
  };
  store?: any;
  workspaceId: string;
  userAgent?: string;
};

export type ProfileUDFTestResponse = {
  error?: {
    message: string;
    stack?: string;
    name: string;
    retryPolicy?: any;
  };
  result: Profile;
  store: any;
  logs: Array<{ message: string; level: string; timestamp: Date; type: string; data?: any }>;
  backend?: string;
};

// Merge user traits from identify events
function mergeUserTraits(events: AnalyticsServerEvent[]): ProfileUser {
  const user: ProfileUser = {
    profileId: (events[0] as any)?._profile_id || "",
    userId: events[0]?.userId || "",
    anonymousId: "",
    traits: {},
  };
  for (const e of events) {
    if (e.type === "identify") {
      if (e.anonymousId) {
        user.anonymousId = e.anonymousId;
      }
      if (e.traits) {
        Object.assign(user.traits, e.traits);
      }
    }
  }
  return user;
}

// Run profile UDF test in a one-time Deno Web Worker
export async function runProfileUDFTest(
  request: ProfileUDFTestRequest,
  store: TTLStore,
  conEntityStore: EntityStore<EnrichedConnectionConfig>
): Promise<ProfileUDFTestResponse> {
  const { id, name, version, code, events, settings } = request;
  const { variables, tableName, destinationId } = settings;
  const user = mergeUserTraits(events);
  const env = getServerEnv();
  const udfTimeoutMs = parseNumber(env.PB_UDF_TIMEOUT_MS || env.UDF_TIMEOUT_MS, 5000);

  const emptyProfile = (): Profile => ({
    profile_id: user.profileId || user.userId,
    destination_id: destinationId,
    table_name: tableName || "profiles",
    traits: {},
    updated_at: new Date(),
  });

  try {
    // Compile to IIFE for worker execution
    const { compileUdfToIIFE } = await import("./udf-shared");
    const iifeCode = await compileUdfToIIFE(code, id, variables);

    const workerUrl = new URL("./profile-worker.mjs", import.meta.url).href;
    const worker = new Worker(workerUrl, {
      type: "module",
      // @ts-ignore Deno-specific
      deno: { permissions: "none" },
    });

    // Logs collected on the main side (e.g. from makeFetch HTTP request entries)
    const mainSideLogs: any[] = [];
    const collectingEventsStore = {
      log: (connectionId: string, level: any, msg: Record<string, any>) => {
        mainSideLogs.push({
          level,
          functionId: id,
          functionType: "profile",
          message: { ...msg, functionId: id, functionType: "profile" },
          timestamp: new Date(),
        });
      },
      close: () => {},
      deadLetter: () => {},
    };
    const fetchTimeout = parseNumber(env.FETCH_TIMEOUT_MS, 2000);
    const proxiedFetch = makeFetch(id, collectingEventsStore, "info", fetchTimeout);

    const result = await new Promise<ProfileUDFTestResponse>(resolve => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({
          error: { message: `Profile function execution timed out after ${udfTimeoutMs}ms`, name: "TimeoutError" },
          result: emptyProfile(),
          store: {},
          logs: mainSideLogs,
        });
      }, udfTimeoutMs);

      worker.onmessage = async (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === "ready") {
          worker.postMessage({ type: "exec", events, user });
          return;
        }

        if (msg.type === "result") {
          clearTimeout(timer);
          worker.terminate();

          // Merge main-side logs (e.g. http-request) with worker logs and sort by timestamp.
          // Both sides use ISO-string or Date timestamps; sort works on either lexically.
          const combinedLogs = [...mainSideLogs, ...(msg.logs || [])].sort((a, b) => {
            const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
            const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
            return ta - tb;
          });
          if (msg.error) {
            resolve({ error: msg.error, result: emptyProfile(), store: {}, logs: combinedLogs });
          } else {
            const r = msg.result;
            const profile: Profile = {
              profile_id: r?.profileId || r?.profile_id || user.profileId || user.userId,
              destination_id: r?.destinationId || r?.destination_id || destinationId,
              table_name: r?.tableName || r?.table_name || tableName || "profiles",
              traits: { ...user.traits, ...r?.traits },
              version,
              updated_at: new Date(),
            };
            resolve({ result: profile, store: {}, logs: combinedLogs });
          }
          return;
        }

        // Handle proxy requests for store/fetch/warehouse
        if (msg.type === "proxyRequest") {
          const { callId, method, args } = msg;
          try {
            let result: any;
            if (method.startsWith("store.")) {
              const op = method.split(".")[1];
              result = await (store as any)[op](...args);
            } else if (method === "fetch") {
              const [url, init] = args;
              const res = await proxiedFetch(url, init);
              const headers: Record<string, string> = {};
              res.headers.forEach((v: string, k: string) => {
                headers[k] = v;
              });
              result = {
                status: res.status,
                statusText: res.statusText,
                ok: res.ok,
                url: res.url,
                headers,
                body: await res.text(),
              };
            } else if (method === "warehouse.query") {
              const [destinationId, sql, params] = args;
              result = await warehouseQuery(request.workspaceId, conEntityStore, destinationId, sql, params);
            }
            worker.postMessage({ type: "proxyResponse", callId, result });
          } catch (err: any) {
            worker.postMessage({ type: "proxyResponse", callId, error: err.message });
          }
          return;
        }
      };

      worker.onerror = (err: ErrorEvent) => {
        clearTimeout(timer);
        worker.terminate();
        resolve({
          error: { message: err.message, name: "WorkerError" },
          result: emptyProfile(),
          store: {},
          logs: mainSideLogs,
        });
      };

      // Initialize worker with compiled code
      worker.postMessage({ type: "init", id, version, iifeCode, variables });
    });

    return result;
  } catch (e: any) {
    if (e.errors && Array.isArray(e.errors)) {
      const errorMessages = e.errors.map((err: any) => err.text).join("\n");
      return {
        error: { message: `Failed to compile profile function ${id}:\n${errorMessages}`, name: "CompilationError" },
        result: emptyProfile(),
        store: {},
        logs: [],
      };
    }
    return {
      error: { message: e.message, stack: e.stack, name: e.name || "Error", retryPolicy: e.retryPolicy },
      result: emptyProfile(),
      store: {},
      logs: [],
    };
  }
}

// Cleanup MongoDB connections
export async function closeProfileBuilderConnections() {
  for (const [key, client] of mongoClients) {
    try {
      await client.close();
    } catch (e: any) {
      log.atWarn().log(`Failed to close MongoDB client ${key}: ${e.message}`);
    }
  }
  mongoClients.clear();
}
