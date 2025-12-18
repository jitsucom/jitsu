import { AnyEvent, EventContext, FullContext } from "@jitsu/protocols/functions";
import {
  EntityStore,
  FuncChainResult,
  FunctionChainContext,
  FunctionContext,
  WorkspaceWithProfiles,
} from "@jitsu/destination-functions";
import { DropRetryErrorName, RetryErrorName, NoRetryErrorName } from "@jitsu/functions-lib";
import { getLog } from "juava";
import { getServerEnv } from "../serverEnv";

const log = getLog("functions-server-client");

// Functions class constants (must match operator values)
export const FunctionsClassDedicated = "dedicated";
export const FunctionsClassFree = "free";
export const FunctionsClassLegacy = "legacy";

/**
 * Get the functions class for a workspace from its feature flags.
 * Format: ${FUNCTIONS_CLASS_FEATURE_FLAG}=<value> (e.g., functionsClass=dedicated)
 */
export function getFunctionsClass(workspaceId: string, workspacesStore: EntityStore<WorkspaceWithProfiles>): string {
  const serverEnv = getServerEnv();
  const workspace = workspacesStore.getObject(workspaceId);
  if (!workspace) {
    return serverEnv.DEFAULT_FUNCTIONS_CLASS;
  }

  const prefix = serverEnv.FUNCTIONS_CLASS_FEATURE_FLAG + "=";
  for (const feature of workspace.featuresEnabled || []) {
    if (feature.startsWith(prefix)) {
      return feature.substring(prefix.length);
    }
  }

  return serverEnv.DEFAULT_FUNCTIONS_CLASS;
}

/**
 * Check if a workspace should use the functions server (not legacy)
 */
export function shouldUseFunctionsServer(functionsClass: string): boolean {
  return functionsClass !== FunctionsClassLegacy && functionsClass !== "";
}

/**
 * Get the functions server URL for a workspace
 */
export function getFunctionsServerUrl(workspaceId: string, connectionId: string): string {
  const serverEnv = getServerEnv();
  const template = serverEnv.FUNCTIONS_SERVER_URL_TEMPLATE;
  const baseUrl = template.replace("${workspaceId}", workspaceId);
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
    message: string;
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
  event: AnyEvent,
  eventContext: EventContext,
  chainCtx?: FunctionChainContext,
  funcCtx?: FunctionContext
): Promise<FunctionsServerResult> {
  const serverEnv = getServerEnv();
  const url = getFunctionsServerUrl(workspaceId, connectionId);
  const timeoutMs = parseInt(serverEnv.FUNCTIONS_SERVER_TIMEOUT_MS);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Functions server returned ${response.status}: ${errorText}`);
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

        const logFn =
          logEntry.level === "error"
            ? chainCtx.log.error
            : logEntry.level === "warn"
            ? chainCtx.log.warn
            : logEntry.level === "debug"
            ? chainCtx.log.debug
            : chainCtx.log.info;
        logFn(logFuncCtx, logEntry.message, ...(logEntry.args || []));
      }
    }

    return result;
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw new Error(`Functions server request timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Create a wrapper function that calls the functions server for UDF execution.
 * Uses FunctionChainContext to properly log function execution results with correct context.
 */
export function createFunctionsServerWrapper(
  workspaceId: string,
  connectionId: string,
  chainCtx: FunctionChainContext,
  funcCtx: FunctionContext
): (event: AnyEvent, ctx: EventContext) => Promise<AnyEvent | AnyEvent[] | "drop" | undefined> {
  return async (event: AnyEvent, ctx: EventContext) => {
    try {
      const result = await callFunctionsServer(workspaceId, connectionId, event, ctx, chainCtx, funcCtx);

      // Check for errors in execLog - similar to checkError in udf-wrapper-code.txtjs
      let errObj: any = undefined;
      for (const entry of result.execLog) {
        const error = entry.error;
        if (error) {
          console.log("Function execution error entry: " + JSON.stringify(entry, null, 2));
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
