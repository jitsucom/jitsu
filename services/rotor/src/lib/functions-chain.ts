import {
  AnyEvent,
  EventContext,
  EventsStore,
  FuncReturn,
  JitsuFunction,
  Store,
  SystemContext,
} from "@jitsu/protocols/functions";
import { createFullContext } from "@jitsu/core-functions";

import { getErrorMessage, getLog, stopwatch } from "juava";
import { EnrichedConnectionConfig } from "@jitsu-internal/console/lib/server/fast-store";

export type Func = {
  id: string;
  exec: JitsuFunction;
  config: any;
  context: SystemContext | {};
};

export type FuncChain = Func[];

const log = getLog("functions-chain");

export type FunctionExecLog = {
  eventIndex: number;
  functionId: string;
  error?: string;
  dropped?: boolean;
  ms: number;
}[];

export async function runChain(
  chain: FuncChain,
  event: AnyEvent,
  connection: EnrichedConnectionConfig,
  eventsStore: EventsStore,
  store: Store,
  eventContext: EventContext
): Promise<FunctionExecLog> {
  const execLog: FunctionExecLog = [];
  let events = [event];
  for (const f of chain) {
    const newEvents: AnyEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      let result: FuncReturn;
      const sw = stopwatch();
      const funcCtx = createFullContext(f.id, eventsStore, store, eventContext, f.context, f.config, event);
      try {
        result = await f.exec(event, funcCtx);
      } catch (err) {
        funcCtx.log.error(`Function execution failed`, err);
        newEvents.push(event);
        execLog.push({
          eventIndex: i,
          functionId: f.id,
          error: getErrorMessage(err),
          ms: sw.elapsedMs(),
        });
        continue;
      }
      execLog.push({
        eventIndex: i,
        functionId: f.id,
        ms: sw.elapsedMs(),
        dropped: isDropResult(result),
      });
      if (isDropResult(result)) {
        return execLog;
      } else if (result) {
        // @ts-ignore
        newEvents.push(...(Array.isArray(result) ? result : [result]));
      } else {
        newEvents.push(event);
      }
    }
    events = newEvents;
  }
  return execLog;
}

function isDropResult(result: FuncReturn): boolean {
  return result === "drop" || (Array.isArray(result) && result.length === 0) || result === null || result === false;
}
