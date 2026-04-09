import { AnyEvent, EventContext } from "@jitsu/protocols/functions";
import { EventsStore, FunctionChainContext, FunctionContext } from "@jitsu/destination-functions";
import { DropRetryErrorName, RetryErrorName, NoRetryErrorName, RetryError } from "@jitsu/functions-lib";
import { getLog, LogLevel, parseNumber } from "juava";
import { getServerEnv } from "../serverEnv";
import { Agent, request, interceptors } from "undici";

const { dns } = interceptors;

const log = getLog("functions-server-client");

const serverEnv = getServerEnv();

const concurrency = parseNumber(serverEnv.CONCURRENCY, 10);
const fsTimeoutMs = parseNumber(serverEnv.FUNCTIONS_SERVER_TIMEOUT_MS, 30000);

export const undiciAgent = new Agent({
  connections: concurrency, // Limit concurrent kept-alive connections to not run out of resources
  maxRequestsPerClient: 3000,
  clientTtl: 10000, // Close idle connections after 10 seconds
  headersTimeout: fsTimeoutMs,
  connectTimeout: fsTimeoutMs,
  bodyTimeout: fsTimeoutMs,
}).compose(
  dns({
    maxTTL: 300000, // cache DNS for 5m
    dualStack: false, // k8s is IPv4, skip AAAA lookups
    affinity: 4, // prefer IPv4
  })
);

/**
 * Get the functions server URL for a workspace
 */
export function getFunctionsServerUrl(deploymentId: string, connectionId: string): string {
  // reload it here for tests. In tests we reset serverEnv cache to dynamically set FS server port
  const serverEnv = getServerEnv();
  const template = serverEnv.FUNCTIONS_SERVER_URL_TEMPLATE;
  const baseUrl = template.replace("${workspaceId}", deploymentId);
  return `${baseUrl}/connection/${connectionId}`;
}

/**
 * HTTP client result from functions server
 */
export type FunctionsServerResult = {
  events: AnyEvent[];
  execLog: Array<{
    eventIndex: number;
    receivedAt: Date;
    functionId: string;
    functionType?: string;
    ms?: number;
    dropped?: boolean;
    error?: any;
  }>;
  logs?: Array<{
    level: string;
    functionId: string;
    functionType?: string;
    message: any;
    args?: any[];
    timestamp: Date;
  }>;
};

/**
 * Call the functions server to execute UDF pipeline for an event
 */
export async function callFunctionsServer(
  deploymentId: string,
  connectionId: string,
  event: AnyEvent,
  eventContext: EventContext,
  chainCtx: FunctionChainContext,
  funcCtx: FunctionContext,
  eventsLogger: EventsStore,
  fetchTimeoutMs?: number
): Promise<FunctionsServerResult> {
  const url = getFunctionsServerUrl(deploymentId, connectionId);

  let response: Awaited<ReturnType<typeof request>> | undefined;
  try {
    response = await request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(fetchTimeoutMs ? { "x-request-timeout-ms": String(fetchTimeoutMs) } : {}),
      },
      body: JSON.stringify({
        event,
        context: eventContext,
      }),
      bodyTimeout: fsTimeoutMs,
      headersTimeout: fsTimeoutMs,
      dispatcher: undiciAgent,
    });

    if (response.statusCode === 404) {
      log.atWarn().log(`Functions server endpoint not found for connection ${connectionId} (404).`);
      return {
        events: [],
        execLog: [],
        logs: [],
      };
    }
    if (response.statusCode !== 200) {
      const errorText = await response.body.text();
      throw new RetryError(`Functions server returned ${response.statusCode}: ${errorText}`);
    }

    const result = (await response.body.json()) as FunctionsServerResult;

    // Replay function logs from the server using FunctionChainContext
    if (result.logs && result.logs.length > 0 && chainCtx) {
      for (const logEntry of result.logs) {
        // Restore FunctionContext from log entry or use the provided one
        const logFuncCtx: FunctionContext = {
          function: {
            id: logEntry.functionId || funcCtx?.function.id || "unknown",
            type: logEntry.functionType || funcCtx?.function.type || "udf",
            debugTill: funcCtx?.function.debugTill,
          },
          props: funcCtx?.props || {},
        };
        if (typeof logEntry.message === "object" && logEntry.message.type === "http-request") {
          eventsLogger.log(connectionId, logEntry.level as LogLevel, logEntry.message);
        } else {
          const logFn =
            logEntry.level === "error"
              ? chainCtx.log.error
              : logEntry.level === "warn"
              ? chainCtx.log.warn
              : logEntry.level === "debug"
              ? chainCtx.log.debug
              : chainCtx.log.info;
          logFn(logFuncCtx, logEntry.message as string, ...(logEntry.args || []));
        }
      }
    }

    return result;
  } catch (e: any) {
    if (e.name === "BodyTimeoutError" || e.name === "HeadersTimeoutError" || e.name === "ConnectTimeoutError") {
      chainCtx.metrics?.status("functions_server", "error", "timeout").inc(1);
      throw new RetryError(`Functions processing timed out after ${fsTimeoutMs}ms.`, { drop: true });
    }
    chainCtx.metrics?.status("functions_server", "error", "other").inc(1);
    throw new RetryError(`Functions processing failed: ${e.message}`, { drop: true });
  } finally {
    // Ensure response body is always consumed to prevent connection leaks
    if (response?.body && !response.body.destroyed) {
      response.body.destroy();
    }
  }
}

/**
 * Create a wrapper function that calls the functions server for UDF execution.
 * Uses FunctionChainContext to properly log function execution results with correct context.
 */
export function createFunctionsServerWrapper(
  deploymentId: string,
  connectionId: string,
  chainCtx: FunctionChainContext,
  funcCtx: FunctionContext,
  eventsLogger: EventsStore,
  fetchTimeoutMs?: number
): (event: AnyEvent, ctx: EventContext) => Promise<AnyEvent | AnyEvent[] | "drop" | undefined> {
  return async (event: AnyEvent, ctx: EventContext) => {
    try {
      const result = await callFunctionsServer(
        deploymentId,
        connectionId,
        event,
        ctx,
        chainCtx,
        funcCtx,
        eventsLogger,
        fetchTimeoutMs
      );

      // Check for errors in execLog - similar to checkError in udf-wrapper-code.txtjs
      let errObj: any = undefined;
      for (const entry of result.execLog) {
        const error = entry.error;
        if (error) {
          // console.log("Function execution error entry: " + JSON.stringify(entry, null, 2));
          const errorName = error.name || "Error";
          // Check if it's a special error type (RetryError, NoRetryError, DropRetryError)
          if (
            !errObj &&
            (errorName === DropRetryErrorName || errorName === RetryErrorName || errorName === NoRetryErrorName)
          ) {
            // Build error object with all properties
            const err: any = {
              name: errorName,
              message: error.message || "Function execution error",
            };
            err.stack = error.stack;
            err.retryPolicy = error.retryPolicy;
            err.event = result.events;
            err.functionId = error.functionId || entry.functionId;
            errObj = err;
          } else {
            // Log non-special errors
            const logFuncCtx: FunctionContext = {
              function: {
                ...funcCtx.function,
                id: error.functionId || entry.functionId,
              },
              props: funcCtx.props,
            };
            chainCtx.log.error(logFuncCtx, "Function execution failed", errorName, error.message);
          }
        }
      }

      // Throw the special error if found
      if (errObj) {
        throw errObj;
      }

      // Check if all events were dropped
      const allDropped = result.execLog.every(e => e.dropped);
      if (allDropped || result.events.length === 0) {
        return "drop";
      }

      // Return the processed events
      if (result.events.length === 1) {
        return result.events[0];
      }
      return result.events;
    } catch (e: any) {
      log.atError().log(`Functions server call failed for connection ${connectionId}: ${e.message}`);
      throw e;
    }
  };
}
