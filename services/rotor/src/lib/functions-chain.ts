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

import Redis from "ioredis";
import { getErrorMessage, getLog, stopwatch } from "juava";
import { EnrichedConnectionConfig } from "@jitsu-internal/console/lib/server/fast-store";

const eventsLogSize = process.env.EVENTS_LOG_MAX_SIZE ? parseInt(process.env.EVENTS_LOG_MAX_SIZE) : 1000;

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
      const funcCtx = createFullContext(f.id, eventsStore, store, eventContext, f.context, f.config);
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
      });
      if (result === "drop") {
        return execLog;
      } else if (result) {
        newEvents.push(...(Array.isArray(result) ? result : [result]));
      } else {
        newEvents.push(event);
      }
    }
    events = newEvents;
  }
  return execLog;
}

export function createRedisLogger(redis: Redis, key: (err: boolean) => string, storeDebug): EventsStore {
  return {
    log: async (error, msg) => {
      try {
        if (msg.type === "log-debug" && !storeDebug) {
          return;
        }
        const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), error, ...msg });
        if (error) {
          await redis.xadd(key(true), "MAXLEN", "~", eventsLogSize, "*", "event", logEntry);
        }
        await redis.xadd(key(false), "MAXLEN", "~", eventsLogSize, "*", "event", logEntry);
      } catch (e) {
        log.atError().withCause(e).log("Failed to put event to redis events log");
      }
    },
  };
}
