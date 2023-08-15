import {
  AnyEvent,
  BatchEventsStore,
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
  dropped?: boolean;
  ms: number;
}[];

export async function runChain(
  chain: FuncChain,
  event: AnyEvent,
  connection: EnrichedConnectionConfig,
  batchEventsStore: BatchEventsStore,
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
      const logs: { error: boolean; msg: Record<string, any> }[] = [];
      const eventsStore: EventsStore = {
        log(error: boolean, msg: Record<string, any>): Promise<void> {
          logs.push({ error, msg });
          return Promise.resolve();
        },
      };
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
      } finally {
        await batchEventsStore.log(logs);
      }
      execLog.push({
        eventIndex: i,
        functionId: f.id,
        ms: sw.elapsedMs(),
        dropped: result === "drop" || (Array.isArray(result) && result.length === 0),
      });
      if (result === "drop" || (Array.isArray(result) && result.length === 0)) {
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

export function createRedisLogger(redis: Redis, key: (err: boolean) => string, storeDebug): BatchEventsStore {
  return {
    log: async (logs: { error: boolean; msg: Record<string, any> }[]) => {
      try {
        if (logs.length === 1) {
          const msg = logs[0].msg;
          const error = logs[0].error;
          if (msg.type === "log-debug" && !storeDebug) {
            return;
          }
          const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), error, ...msg });
          if (error) {
            await redis.xadd(key(true), "MAXLEN", "~", eventsLogSize, "*", "event", logEntry);
          }
          await redis.xadd(key(false), "MAXLEN", "~", eventsLogSize, "*", "event", logEntry);
        } else {
          const pipeline = redis.pipeline();
          for (const log of logs) {
            const msg = log.msg;
            const error = log.error;
            if (msg.type === "log-debug" && !storeDebug) {
              continue;
            }
            const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), error, ...msg });
            if (error) {
              pipeline.xadd(key(true), "MAXLEN", "~", eventsLogSize, "*", "event", logEntry);
            }
            pipeline.xadd(key(false), "MAXLEN", "~", eventsLogSize, "*", "event", logEntry);
          }
          await pipeline.exec();
        }
      } catch (e) {
        log.atError().withCause(e).log("Failed to put event to redis events log");
      }
    },
  };
}
