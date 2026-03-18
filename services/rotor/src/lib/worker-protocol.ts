// Shared types for main↔worker communication (Deno Web Workers)

import type { AnyEvent, EventContext } from "@jitsu/protocols/functions";
import type { EnrichedConnectionConfig, FunctionExecLog } from "@jitsu/core-functions-lib";

// ── Messages: Main → Worker ─────────────────────────────────────────

/** Sent once after worker creation to bootstrap it with compiled UDF code and connection configs */
export type InitMessage = {
  type: "init";
  /** One entry per connection in the workspace */
  connections: WorkerConnectionInit[];
};

export type WorkerConnectionInit = {
  connectionId: string;
  /** Stripped connection config (no credentials / functionsEnv) */
  connection: StrippedConnectionConfig;
  /** Each UDF compiled to an IIFE string by esbuild */
  functions: WorkerFunctionInit[];
  /** Whether warehouse queries are allowed */
  warehouseEnabled: boolean;
  /** debugTill ISO string (if set) */
  debugTill?: string;
  /** fetchLogLevel from connection options */
  fetchLogLevel?: string;
  /** functionsEnv / props */
  props: Record<string, any>;
};

export type WorkerFunctionInit = {
  id: string;
  /** IIFE code string – evaluated via new Function() inside the worker */
  iifeCode: string;
};

/** Ask the worker to execute a chain for a given connection */
export type ExecMessage = {
  type: "exec";
  requestId: string;
  connectionId: string;
  event: AnyEvent;
  eventContext: EventContext;
  fetchTimeoutMs: number;
};

/** Cancel a pending execution */
export type CancelMessage = {
  type: "cancel";
  requestId: string;
};

/** Ask the worker to report its heap memory usage */
export type MemoryQueryMessage = {
  type: "memoryQuery";
};

/** Response to a proxy request from the worker */
export type ProxyResponseMessage = {
  type: "proxyResponse";
  callId: string;
  result?: any;
  error?: string;
};

export type MainToWorkerMessage = InitMessage | ExecMessage | CancelMessage | MemoryQueryMessage | ProxyResponseMessage;

// ── Messages: Worker → Main ─────────────────────────────────────────

/** Worker is ready to accept exec messages */
export type ReadyMessage = {
  type: "ready";
};

export type DebugMessage = {
  type: "debug";
  value: any;
};

/** Result of a chain execution */
export type ResultMessage = {
  type: "result";
  requestId: string;
  connectionId: string;
  events: AnyEvent[];
  execLog: FunctionExecLog;
  logs: SerializedLogEntry[];
};

/** Proxy request for I/O that the sandboxed worker cannot perform */
export type ProxyRequestMessage = {
  type: "proxyRequest";
  callId: string;
  method: ProxyMethod;
  args: any[];
};

export type ProxyMethod =
  | "store.get"
  | "store.set"
  | "store.del"
  | "store.ttl"
  | "store.getOrSet"
  | "store.getWithTTL"
  | "fetch"
  | "warehouse.query";

/** Fire-and-forget log from the worker */
export type LogMessage = {
  type: "log";
  level: "info" | "warn" | "debug" | "error";
  functionId: string;
  functionType: string;
  message: any;
  args?: any[];
  timestamp: string;
};

/** Worker's heap memory usage report */
export type MemoryResponseMessage = {
  type: "memoryResponse";
  heapUsedBytes: number;
  heapTotalBytes: number;
};

export type WorkerToMainMessage =
  | ReadyMessage
  | ResultMessage
  | ProxyRequestMessage
  | LogMessage
  | DebugMessage
  | MemoryResponseMessage;

// ── Shared helper types ─────────────────────────────────────────────

/** Serialized log entry (Date → ISO string for postMessage transfer) */
export type SerializedLogEntry = {
  level: "info" | "warn" | "debug" | "error";
  functionId: string;
  functionType: string;
  message: any;
  args?: any[];
  timestamp: string;
};

/** Connection config without credentials (safe to send to worker) */
export type StrippedConnectionConfig = Omit<EnrichedConnectionConfig, "credentials" | "credentialsHash">;
