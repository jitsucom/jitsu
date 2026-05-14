// Shared function chain execution logic used by both:
// - functions-server.ts (in-process, real context)
// - workspace-worker.ts (sandboxed Deno worker, proxied context)
//
// This module must NOT import esbuild or any other build-time dependency —
// it is bundled into workspace-worker.mjs, which runs in a permission-less Deno
// sandbox. esbuild/compilation helpers live in udf-shared.ts instead.

import * as functionLib from "@jitsu/functions-lib";
import type { AnyEvent, EventContext, FullContext, FuncReturn } from "@jitsu/protocols/functions";
import type { FunctionExecLog, FunctionExecRes } from "@jitsu/core-functions-lib";

export type ChainFunction = {
  id: string;
  exec: (event: AnyEvent, ctx: FullContext) => Promise<FuncReturn>;
  config?: any;
};

export type BuildContextFn<TLog> = (functionId: string, functionType: string, logs: TLog[]) => FullContext;

export function deepCopy<T>(o: T): T {
  if (typeof o !== "object") return o;
  if (!o) return o;
  if (Array.isArray(o)) {
    const newO: any[] = [];
    for (let i = 0; i < o.length; i++) {
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

export function isDropResult(result: any): boolean {
  return result === "drop" || (Array.isArray(result) && result.length === 0) || result === null || result === false;
}

/**
 * Run a chain of UDF functions over a single event.
 *
 * The caller provides a `buildContext` callback that creates the appropriate
 * FullContext for each function invocation — this is the only part that
 * differs between the in-process runtime and the sandboxed worker runtime.
 */
export async function runFunctionChain<TLog>(
  functions: ChainFunction[],
  event: AnyEvent,
  eventContext: EventContext,
  buildContext: BuildContextFn<TLog>
): Promise<{ events: AnyEvent[]; execLog: FunctionExecLog; logs: TLog[] }> {
  const execLog: FunctionExecLog = [];
  const logs: TLog[] = [];
  let events: AnyEvent[] = [event];

  for (let k = 0; k < functions.length; k++) {
    const func = functions[k];
    const newEvents: AnyEvent[] = [];

    for (let i = 0; i < events.length; i++) {
      const currentEvent = events[i];
      const startMs = Date.now();
      let result: FuncReturn = undefined;

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
        const ctx = buildContext(id, functionType, logs);
        result = await func.exec(deepCopy(currentEvent), ctx);

        if (k < functions.length - 1 && Array.isArray(result) && result.length > 1) {
          const l = result.length;
          result = undefined;
          const err = new Error(
            `Got ${l} events as result of function #${k + 1} of ${
              functions.length
            }. Only the last function in a chain is allowed to multiply events.`
          );
          err.name = functionLib.NoRetryErrorName;
          throw err;
        }
      } catch (err: any) {
        if (err?.name === functionLib.DropRetryErrorName || err?.name === functionLib.NoRetryErrorName) {
          result = "drop";
        }
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
      }

      execLogEntry.ms = Date.now() - startMs;
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
    if (events.length === 0) break;
  }

  return { events, execLog, logs };
}
