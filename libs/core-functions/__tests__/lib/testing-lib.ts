import { AnalyticsInterface, AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { requireDefined } from "juava";
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
  const func = opts.func;
  const fetch = nodeFetch;
  const log = {
    info: (msg: any, ...args: any[]) => console.log(prefixLogMessage("INFO", msg), args),
    error: (msg: any, ...args: any[]) => console.error(prefixLogMessage("ERROR", msg), args),
    debug: (msg: any, ...args: any[]) => console.debug(prefixLogMessage("DEBUG", msg), args),
    warn: (msg: any, ...args: any[]) => console.warn(prefixLogMessage("WARN", msg), args),
  };

  let res: AnyEvent[] = null;
  for (const event of events) {
    try {
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
      console.log(`Error running function`, e);
      throw e;
    }
  }
  return res;
}
