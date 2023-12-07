import { AnalyticsInterface, AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { getLog, logFormat, requireDefined } from "juava";
import { AnyEvent, EventContext, FuncReturn, FunctionContext, JitsuFunction } from "@jitsu/protocols/functions";
import nodeFetch from "node-fetch-commonjs";
import { createStore } from "./mem-store";
import * as JSON5 from "json5";
import { SystemContext } from "../../src";

export type Or<T1, T2> =
  | ({ [P in keyof T1]: T1[P] } & { [P in keyof T2]?: never })
  | ({ [P in keyof T1]?: never } & { [P in keyof T2]: T2[P] });

export type TestOptions<T = any> = {
  mockFetch?: boolean;
  func: JitsuFunction<AnalyticsServerEvent, T>;
  ctx?: EventContext & FunctionContext & { $system?: Partial<SystemContext["$system"]> };
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

function parse(varName: string, varContent: string): any {
  try {
    return JSON5.parse(varContent);
  } catch (e) {
    throw new Error(`Error parsing env.${varName}: ${e.message}. Content: ${varContent}`);
  }
}

export async function testJitsuFunction<T = any>(opts: TestOptions<T>): Promise<FuncReturn> {
  const config =
    opts.config ||
    parse(
      opts.configEnvVar,
      requireDefined(process.env[opts.configEnvVar], `${opts.configEnvVar} env var is not defined`)
    );
  //generateEvents is not supported yet
  if (opts.generateEvents) {
    throw new Error("generateEvents() is not supported yet");
  }
  if (opts.mockFetch) {
    throw new Error("mockFetch() is not supported yet");
  }
  const events: AnalyticsServerEvent[] = opts.events;
  const func = opts.func;
  const fetch = nodeFetch;
  const log = {
    info: (msg: any, ...args: any[]) => testLogger.atInfo().log(msg, ...args),
    error: (msg: any, ...args: any[]) => testLogger.atError().log(msg, ...args),
    debug: (msg: any, ...args: any[]) => testLogger.atDebug().log(msg, ...args),
    warn: (msg: any, ...args: any[]) => testLogger.atWarn().log(msg, ...args),
  };

  let res: AnyEvent[] = null;
  for (const event of events) {
    const eventName = event.event || event.type;
    try {
      testLogger
        .atInfo()
        .log(
          `📌Testing ${logFormat.bold(eventName)} message of ${toDate(event.timestamp).toISOString()}`
        );
      const r = await func(event, {
        props: config,
        fetch,
        log,
        headers: {},
        store: createStore(),
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
      testLogger.atError().log(`Error running function ${func.displayName || func.name} on ${eventName}`, e);
      throw e;
    }
  }
  return res;
}
