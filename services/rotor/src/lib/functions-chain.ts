import {
  AnyEvent,
  EventContext,
  EventsStore,
  FuncReturn,
  JitsuFunction,
  Store,
  SystemContext,
} from "@jitsu/protocols/functions";
import { createFullContext, isDropResult } from "@jitsu/core-functions";
import { RetryErrorName, DropRetryErrorName } from "@jitsu/functions-lib";

import { getLog, stopwatch } from "juava";
import { EnrichedConnectionConfig } from "@jitsu-internal/console/lib/server/fast-store";
import { retryLogMessageIfNeeded } from "./retries";

export type Func = {
  id: string;
  exec: JitsuFunction;
  config: any;
  context: SystemContext | {};
};

export type FuncChain = Func[];

const log = getLog("functions-chain");

export type FuncChainResult = {
  events: AnyEvent[];
  execLog: FunctionExecLog;
};

export type FunctionExecRes = {
  eventIndex: number;
  event?: any;
  functionId: string;
  error?: any;
  dropped?: boolean;
  ms: number;
};

export type FunctionExecLog = FunctionExecRes[];

export function checkError(chainRes: FuncChainResult) {
  for (const el of chainRes.execLog) {
    if (el.error && (el.error.name === DropRetryErrorName || el.error.name === RetryErrorName)) {
      // throw retry errors above to schedule retry
      const err = el.error;
      err.event = el.event;
      err.functionId = err.functionId || el.functionId;
      throw err;
    }
  }
}

export async function runChain(
  chain: FuncChain,
  event: AnyEvent,
  connection: EnrichedConnectionConfig,
  eventsStore: EventsStore,
  store: Store,
  eventContext: EventContext
): Promise<FuncChainResult> {
  const execLog: FunctionExecLog = [];
  let events = [event];
  for (const f of chain) {
    const newEvents: AnyEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      let result: FuncReturn = undefined;
      const sw = stopwatch();
      const funcCtx = createFullContext(f.id, eventsStore, store, eventContext, f.context, f.config, event);
      try {
        result = await f.exec(event, funcCtx);
        execLog.push({
          eventIndex: i,
          functionId: f.id,
          ms: sw.elapsedMs(),
          dropped: isDropResult(result),
        });
      } catch (err: any) {
        if (err.name === DropRetryErrorName) {
          result = "drop";
        }
        execLog.push({
          eventIndex: i,
          functionId: f.id,
          event,
          error: err,
          ms: sw.elapsedMs(),
          dropped: isDropResult(result),
        });
        if (f.id === "udf.PIPELINE") {
          if (err.name !== DropRetryErrorName && err.event) {
            // if udf pipeline has multiple functions and failed in the middle w/o drop error
            // pass partial result of pipeline to the destination function
            newEvents.push(err.event);
            continue;
          }
        } else {
          funcCtx.log.error(`Function execution failed`, err, retryLogMessageIfNeeded(err, eventContext.retries ?? 0));
        }
      }
      if (!isDropResult(result)) {
        if (result) {
          // @ts-ignore
          newEvents.push(...(Array.isArray(result) ? result : [result]));
        } else {
          newEvents.push(event);
        }
      }
    }
    events = newEvents;
  }
  return { events, execLog };
}
