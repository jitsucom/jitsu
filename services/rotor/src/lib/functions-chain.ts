import { AnyEvent, EventContext, EventsStore, FuncReturn, JitsuFunction, Store } from "@jitsu/protocols/functions";
import { createFullContext, isDropResult, MetricsMeta, SystemContext } from "@jitsu/core-functions";
import { RetryErrorName, DropRetryErrorName } from "@jitsu/functions-lib";

import { getLog, stopwatch } from "juava";
import { retryObject } from "./retries";

export type Func = {
  id: string;
  exec: JitsuFunction;
  config: any;
  context: SystemContext | {};
};

export type FuncChain = Func[];

const log = getLog("functions-chain");

export type FuncChainResult = {
  connectionId?: string;
  events: AnyEvent[];
  execLog: FunctionExecLog;
};

export type FunctionExecRes = {
  receivedAt?: any;
  eventIndex: number;
  event?: any;
  metricsMeta?: MetricsMeta;
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
      const rat = new Date(event.receivedAt) as any;
      const execLogMeta = {
        eventIndex: i,
        receivedAt: rat && rat != "Invalid Date" ? rat : new Date(),
        functionId: f.id,
        metricsMeta: Object.hasOwn(f.context, "$system") ? (f.context as SystemContext).$system.metricsMeta : undefined,
      };
      try {
        result = await f.exec(event, funcCtx);
        const ms = sw.elapsedMs();
        // if (ms > 100) {
        //   console.log(`Function ${f.id} took ${ms}ms to execute`);
        // }
        execLog.push({
          ...execLogMeta,
          ms,
          dropped: isDropResult(result),
        });
      } catch (err: any) {
        if (err.name === DropRetryErrorName) {
          result = "drop";
        }
        const ms = sw.elapsedMs();
        // if (ms > 100) {
        //   console.log(`Function ${f.id} took ${ms}ms to execute`);
        // }
        execLog.push({
          ...execLogMeta,
          event,
          error: err,
          ms,
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
          const args = [err?.name, err?.message];
          const r = retryObject(err, eventContext.retries ?? 0);
          if (r) {
            args.push(r);
          }
          if (r?.retry?.left ?? 0 > 0) {
            funcCtx.log.warn(`Function execution failed`, ...args);
          } else {
            funcCtx.log.error(`Function execution failed`, ...args);
          }
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
