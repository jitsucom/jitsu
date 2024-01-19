import {
  AnyEvent,
  EventContext,
  EventsStore,
  FullContext,
  FuncReturn,
  JitsuFunction,
  Store,
} from "@jitsu/protocols/functions";
import {
  createFullContext,
  getBuiltinFunction,
  isDropResult,
  MetricsMeta,
  SystemContext,
  UDFWrapper,
} from "@jitsu/core-functions";
import { RetryErrorName, DropRetryErrorName } from "@jitsu/functions-lib";

import { getLog, newError, requireDefined, stopwatch } from "juava";
import { retryObject } from "./retries";
import NodeCache from "node-cache";
import pick from "lodash/pick";
import { EnrichedConnectionConfig } from "./config-types";
import { EntityStore } from "./entity-store";

export type Func = {
  id: string;
  exec: JitsuFunction;
  config: any;
  enableSystemContext: boolean;
};

export type FuncChain = Func[];

const log = getLog("functions-chain");
const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");

//cache compiled udfs for 10min (ttl is extended on each access)
const udfTTL = 60 * 10;
const udfCache = new NodeCache({ stdTTL: udfTTL, checkperiod: 60, useClones: false });
udfCache.on("del", (key, value) => {
  log.atInfo().log(`UDF ${key} deleted from cache`);
  value.wrapper?.close();
});

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
const getCachedOrLoad = (cache: NodeCache, key: string, loader: (key: string) => any) => {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const loaded = loader(key);
  cache.set(key, loaded);
  return loaded;
};

export function buildFunctionChain(
  connection: EnrichedConnectionConfig,
  func: EntityStore,
  functionsFilter?: (id: string) => boolean
) {
  let mainFunction;
  const connectionData = connection.options as any;
  if (connection.usesBulker) {
    mainFunction = {
      functionId: "builtin.destination.bulker",
      functionOptions: {
        bulkerEndpoint: bulkerBase,
        destinationId: connection.id,
        authToken: bulkerAuthKey,
        dataLayout: connectionData.dataLayout ?? "segment-single-table",
      },
    };
  } else {
    const builtin = getBuiltinFunction(`builtin.destination.${connection.type}`);
    if (builtin) {
      mainFunction = {
        functionId: `builtin.destination.${connection.type}`,
        functionOptions: connection.credentials,
      };
    } else {
      throw newError(
        `Connection with id ${connection.id} has no functions assigned to it's destination type - ${connection.type}`
      );
    }
  }
  const functions = functionsFilter
    ? [...(connectionData.functions || []), mainFunction].filter(f => functionsFilter(f.functionId))
    : [...(connectionData.functions || []), mainFunction];

  const udfFuncChain: FuncChain = functions
    .filter(f => f.functionId.startsWith("udf."))
    .map(f => {
      const functionId = f.functionId.substring(4);
      const userFunctionObj = func.getObject(functionId);
      if (!userFunctionObj || userFunctionObj.workspaceId !== connection.workspaceId) {
        return {
          id: f.functionId as string,
          config: {},
          exec: async (event, ctx) => {
            throw newError(`Function ${functionId} not found in workspace: ${connection.workspaceId}`);
          },
          enableSystemContext: false,
        };
      }
      const code = userFunctionObj.code;
      const codeHash = userFunctionObj.codeHash;
      let cached = getCachedOrLoad(udfCache, functionId, key => {
        return { wrapper: UDFWrapper(key, userFunctionObj.name, code), hash: codeHash };
      });
      if (cached.hash !== codeHash) {
        log.atInfo().log(`UDF ${functionId} changed (hash ${codeHash} != ${cached.hash}). Reloading`);
        cached = { wrapper: UDFWrapper(functionId, userFunctionObj.name, code), hash: codeHash };
        udfCache.set(functionId, cached);
      }
      udfCache.ttl(functionId, udfTTL);
      return {
        id: f.functionId as string,
        config: f.functionOptions as any,
        exec: async (event, ctx) => {
          try {
            return await cached.wrapper.userFunction(event, ctx);
          } catch (e: any) {
            if (e?.message === "Isolate is disposed") {
              log.atError().log(`UDF ${functionId} VM was disposed. Reloading`);
              cached = { wrapper: UDFWrapper(functionId, userFunctionObj.name, code), hash: codeHash };
              udfCache.set(functionId, cached);
              return await cached.wrapper.userFunction(event, ctx);
            } else {
              throw e;
            }
          }
        },
        enableSystemContext: false,
      };
    });
  const aggregatedFunctions: any[] = [
    ...functions.filter(f => f.functionId.startsWith("builtin.transformation.")),
    ...(udfFuncChain.length > 0 ? [{ functionId: "udf.PIPELINE" }] : []),
    ...functions.filter(f => f.functionId.startsWith("builtin.destination.")),
  ];

  const udfPipelineFunc = async (event: AnyEvent, ctx: FullContext) => {
    const chainRes = await runChain(
      udfFuncChain,
      event,
      ctx["$system"].eventsStore,
      ctx.store,
      pick(ctx, ["geo", "ua", "headers", "source", "destination", "connection", "retries"])
    );
    checkError(chainRes);
    return chainRes.events;
  };

  const funcChain: FuncChain = aggregatedFunctions
    .filter(f => (functionsFilter ? functionsFilter(f.functionId) : true))
    .map(f => {
      if (f.functionId.startsWith("builtin.")) {
        return {
          id: f.functionId as string,
          config: f.functionOptions as any,
          exec: requireDefined(getBuiltinFunction(f.functionId), `Unknown function ${f.functionId}`) as JitsuFunction,
          enableSystemContext: true,
        };
      } else if (f.functionId === "udf.PIPELINE") {
        return {
          id: f.functionId as string,
          config: {},
          exec: udfPipelineFunc,
          enableSystemContext: true,
        };
      } else {
        throw newError(`Function of unknown type: ${f.functionId}`);
      }
    });
  return funcChain;
}

export async function runChain(
  chain: FuncChain,
  event: AnyEvent,
  eventsStore: EventsStore,
  store: Store,
  eventContext: EventContext,
  systemContext?: SystemContext
): Promise<FuncChainResult> {
  const execLog: FunctionExecLog = [];
  let events = [event];
  for (const f of chain) {
    const newEvents: AnyEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      let result: FuncReturn = undefined;
      const sw = stopwatch();
      const funcCtx = createFullContext(
        f.id,
        eventsStore,
        store,
        eventContext,
        f.enableSystemContext && systemContext ? systemContext : {},
        f.config,
        event
      );
      const rat = new Date(event.receivedAt) as any;
      const execLogMeta = {
        eventIndex: i,
        receivedAt: rat && rat != "Invalid Date" ? rat : new Date(),
        functionId: f.id,
        metricsMeta: systemContext?.$system?.metricsMeta,
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
