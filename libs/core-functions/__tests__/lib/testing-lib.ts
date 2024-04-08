import { AnalyticsInterface, AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { getLog, logFormat, requireDefined } from "juava";
import nodeFetch from "node-fetch-commonjs";
import { AnyEvent, EventContext, FuncReturn, JitsuFunction } from "@jitsu/protocols/functions";
import { createStore } from "./mem-store";
import * as JSON5 from "json5";
import { FunctionChainContext, FunctionContext, InternalFetchType, wrapperFunction } from "../../src/functions/lib";

export type Or<T1, T2> =
  | ({ [P in keyof T1]: T1[P] } & { [P in keyof T2]?: never })
  | ({ [P in keyof T1]?: never } & { [P in keyof T2]: T2[P] });

export type TestOptions<T = any> = {
  mockFetch?: boolean;
  func: JitsuFunction<AnalyticsServerEvent, T>;
  chainCtx?: FunctionChainContext;
  ctx?: EventContext;
} & Or<{ config: T }, { configEnvVar: string }> &
  Or<{ generateEvents: (jitsu: AnalyticsInterface) => void }, { events: AnalyticsServerEvent[] }>;

export function prefixLogMessage(level: string, msg: any) {
  return `[${level}] ${msg}`;
}
const testLogger = getLog("function-tester");

function toDate(timestamp?: string | number | Date): Date {
  if (!timestamp) {
    return new Date();
  }
  if (typeof timestamp === "string") {
    return new Date(timestamp);
  } else if (typeof timestamp === "number") {
    return new Date(timestamp);
  } else {
    return timestamp;
  }
}

export async function testJitsuFunction<T = any>(opts: TestOptions<T>): Promise<FuncReturn> {
  const config =
    opts.config ||
    JSON5.parse(requireDefined(process.env[opts.configEnvVar], `${opts.configEnvVar} env var is not defined`));
  //generateEvents is not supported yet
  if (opts.generateEvents) {
    throw new Error("generateEvents() is not supported yet");
  }
  if (opts.mockFetch) {
    throw new Error("mockFetch() is not supported yet");
  }
  const events: AnalyticsServerEvent[] = opts.events;
  const log = {
    info: (ctx: FunctionContext, msg: any, ...args: any[]) => testLogger.atInfo().log(msg, ...args),
    error: (ctx: FunctionContext, msg: any, ...args: any[]) => testLogger.atError().log(msg, ...args),
    debug: (ctx: FunctionContext, msg: any, ...args: any[]) => testLogger.atDebug().log(msg, ...args),
    warn: (ctx: FunctionContext, msg: any, ...args: any[]) => testLogger.atWarn().log(msg, ...args),
  };
  const func = wrapperFunction(
    { log, fetch: nodeFetch as unknown as InternalFetchType, store: createStore(), ...opts.chainCtx },
    { function: { id: "test", type: "test" }, props: config },
    opts.func
  );

  let res: AnyEvent[] = null;
  for (const event of events) {
    try {
      testLogger
        .atInfo()
        .log(
          `📌Testing ${logFormat.bold(event.event || event.type)} message of ${toDate(event.timestamp).toISOString()}`
        );
      const r = await func(event, {
        headers: {},
        ...opts.ctx,
      });
      if (r) {
        if (r === "drop") {
          break;
        }
        if (res == null) {
          res = [];
        }
        if (Array.isArray(r)) {
          res.push(...r);
        } else {
          res.push(r);
        }
      }
    } catch (e) {
      console.log(`Error running function`, e);
      throw e;
    }
  }
  return res;
}
