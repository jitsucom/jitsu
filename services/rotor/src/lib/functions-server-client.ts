import { AnyEvent, EventContext, FullContext } from "@jitsu/protocols/functions";
import {
  EntityStore,
  EventsStore,
  FuncChainResult,
  FunctionChainContext,
  FunctionContext,
  WorkspaceWithProfiles,
} from "@jitsu/destination-functions";
import { DropRetryErrorName, RetryErrorName, NoRetryErrorName, RetryError } from "@jitsu/functions-lib";
import { getLog, LogLevel } from "juava";
import { getServerEnv } from "../serverEnv";

const log = getLog("functions-server-client");

export type FunctionsClass = "premium" | "dedicated" | "free" | "legacy";
// Functions class constants (must match operator values)
export const FunctionsClassDedicated = "dedicated";
export const FunctionsClassPremium = "premium";
export const FunctionsClassFree = "free";
export const FunctionsClassLegacy = "legacy";

/**
 * Get the functions class for a workspace from its feature flags.
 * Format: ${FUNCTIONS_CLASS_FEATURE_FLAG}=<value> (e.g., functionsClass=dedicated)
 * @deprecated Use getFunctionsClassesFromOptions instead - functionsClasses is now passed in connection options
 */
export function getFunctionsClasses(workspace: WorkspaceWithProfiles): FunctionsClass[] {
  const serverEnv = getServerEnv();

  const prefix = serverEnv.FUNCTIONS_CLASS_FEATURE_FLAG + "=";
  for (const feature of workspace.featuresEnabled || []) {
    if (feature.startsWith(prefix)) {
      const classes = feature
        .substring(prefix.length)
        .split(",")
        .map(f => f.trim())
        .filter(
          f =>
            f === FunctionsClassPremium ||
            f === FunctionsClassDedicated ||
            f === FunctionsClassFree ||
            f === FunctionsClassLegacy
        ) as FunctionsClass[];
      if (classes.length > 0) {
        return classes;
      }
    }
  }

  return [serverEnv.DEFAULT_FUNCTIONS_CLASS] as FunctionsClass[];
}

/**
 * Get the functions classes from connection options.
 * functionsClasses is set during connection export from workspace.featuresEnabled.
 */
export function getFunctionsClassesFromOptions(options: any): FunctionsClass[] {
  const serverEnv = getServerEnv();

  if (options?.functionsClasses && Array.isArray(options.functionsClasses) && options.functionsClasses.length > 0) {
    const classes = options.functionsClasses.filter(
      (f: string) =>
        f === FunctionsClassPremium ||
        f === FunctionsClassDedicated ||
        f === FunctionsClassFree ||
        f === FunctionsClassLegacy
    ) as FunctionsClass[];
    if (classes.length > 0) {
      return classes;
    }
  }

  return [serverEnv.DEFAULT_FUNCTIONS_CLASS] as FunctionsClass[];
}

/**
 * Check if a workspace should use the functions server (not legacy)
 */
export function shouldUseFunctionsServer(functionsClasses: string[]): boolean {
  return !functionsClasses.includes(FunctionsClassLegacy) && !functionsClasses.includes("");
}

/**
 * Get the functions server URL for a workspace
 */
export function getFunctionsServerUrl(
  workspaceId: string,
  connectionId: string,
  functionsClass: Omit<FunctionsClass, "legacy">
): string {
  const serverEnv = getServerEnv();
  const template = serverEnv.FUNCTIONS_SERVER_URL_TEMPLATE;
  const baseUrl = template.replace("${workspaceId}", functionsClass === "free" ? "free" : workspaceId);
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
  workspaceId: string,
  connectionId: string,
  functionsClass: Omit<FunctionsClass, "legacy">,
  event: AnyEvent,
  eventContext: EventContext,
  chainCtx: FunctionChainContext,
  funcCtx: FunctionContext,
  eventsLogger: EventsStore,
  fetchTimeoutMs?: number
): Promise<FunctionsServerResult> {
  const serverEnv = getServerEnv();
  const url = getFunctionsServerUrl(workspaceId, connectionId, functionsClass);
  const timeoutMs = parseInt(serverEnv.FUNCTIONS_SERVER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(fetchTimeoutMs ? { "x-request-timeout-ms": String(fetchTimeoutMs) } : {}),
      },
      body: JSON.stringify({
        event,
        context: {
          headers: eventContext.headers,
          source: eventContext.source,
          destination: eventContext.destination,
          connection: eventContext.connection,
          workspace: eventContext.workspace,
          receivedAt: eventContext.receivedAt,
          retries: eventContext.retries ?? 0,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new RetryError(`Functions server returned ${response.status}: ${errorText}`);
    }

    const result = (await response.json()) as FunctionsServerResult;

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
    if (e.name === "AbortError") {
      chainCtx.metrics?.status("functions_server", "error", "timeout").inc(1);
      throw new RetryError(`Functions processing timed out after ${timeoutMs}ms.`);
    }
    chainCtx.metrics?.status("functions_server", "error", "other").inc(1);
    throw new RetryError(`Functions processing failed: ${e.message}`);
  }
}

/**
 * Create a wrapper function that calls the functions server for UDF execution.
 * Uses FunctionChainContext to properly log function execution results with correct context.
 */
export function createFunctionsServerWrapper(
  workspaceId: string,
  connectionId: string,
  functionsClass: Omit<FunctionsClass, "legacy">,
  chainCtx: FunctionChainContext,
  funcCtx: FunctionContext,
  eventsLogger: EventsStore,
  fetchTimeoutMs?: number
): (event: AnyEvent, ctx: EventContext) => Promise<AnyEvent | AnyEvent[] | "drop" | undefined> {
  return async (event: AnyEvent, ctx: EventContext) => {
    try {
      const result = await callFunctionsServer(
        workspaceId,
        connectionId,
        functionsClass,
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
