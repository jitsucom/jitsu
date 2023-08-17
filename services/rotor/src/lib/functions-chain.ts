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

export function createRedisLogger(redis: Redis, key: (err: boolean) => string, storeDebug): EventsStore {
  const buffer: Record<string, string[]> = {};

  const put = (key: string, logEntry: string) => {
    let buf = buffer[key];
    if (!buf) {
      buffer[key] = buf = [];
    }
    if (buf.length < eventsLogSize) {
      buf.push(logEntry);
    }
  };

  const flush = async () => {
    if (Object.keys(buffer).length === 0) {
      return;
    }
    const copy = { ...buffer };
    for (const key in buffer) {
      delete buffer[key];
    }
    try {
      const pipeline = redis.pipeline();
      for (const [key, buf] of Object.entries(copy)) {
        for (let i = 0; i < buf.length; i++) {
          const logEntry = buf[i];
          if (i === buf.length - 1) {
            log.atDebug().log(`Posting ${buf.length} events to stream [${key}]`);
            pipeline.xadd(key, "MAXLEN", "~", eventsLogSize, "*", "event", logEntry);
          } else {
            pipeline.xadd(key, "*", "event", logEntry);
          }
        }
      }
      await pipeline.exec();
    } catch (e) {
      log.atError().withCause(e).log(`Failed to flush events logs to redis`);
    }
  };

  setInterval(async () => {
    if (Object.keys(buffer).length === 0) {
      return;
    }
    await flush();
  }, 5000);

  return {
    log: async (error, msg) => {
      try {
        if (msg.type === "log-debug" && !storeDebug) {
          return;
        }
        const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), error, ...msg });
        if (error) {
          put(key(true), logEntry);
        }
        put(key(false), logEntry);
      } catch (e) {
        log.atError().withCause(e).log("Failed to put event to redis events log");
      }
    },
  };
}
