import { AnonymousEventsStore, AnyEvent, EventContext, FuncReturn } from "@jitsu/protocols/functions";
import {
  createMongoStore,
  createMultiStore,
  createTtlStore,
  FunctionChainContext,
  FunctionContext,
  getBuiltinFunction,
  isDropResult,
  JitsuFunctionWrapper,
  makeFetch,
  makeLog,
  MetricsMeta,
  mongodb,
  UDFWrapper,
  wrapperFunction,
} from "@jitsu/core-functions";
import Prometheus from "prom-client";
import { RetryErrorName, DropRetryErrorName } from "@jitsu/functions-lib";

import { getLog, newError, requireDefined, stopwatch } from "juava";
import { retryObject } from "./retries";
import NodeCache from "node-cache";
import isEqual from "lodash/isEqual";
import { EnrichedConnectionConfig, FunctionConfig } from "./config-types";
import { EntityStore } from "./entity-store";
import { MessageHandlerContext } from "./message-handler";

const fastStoreWorkspaceId = (process.env.FAST_STORE_WORKSPACE_ID ?? "").split(",").filter(x => x.length > 0);

export type Func = {
  id: string;
  exec: JitsuFunctionWrapper;
  context: FunctionContext;
  hash?: string;
};

export type FuncChain = {
  context: FunctionChainContext;
  functions: Func[];
};

export type FuncChainFilter = "all" | "udf-n-dst" | "dst-only";

const log = getLog("functions-chain");
const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");

const functionsInFlight = new Prometheus.Gauge({
  name: "rotor_functions_in_flight",
  help: "Functions in flight",
  // add `as const` here to enforce label names
  labelNames: ["connectionId", "functionId"] as const,
});
const functionsTime = new Prometheus.Histogram({
  name: "rotor_functions_time",
  help: "Functions execution time in ms",
  buckets: [1, 10, 100, 200, 1000, 2000, 3000, 4000, 5000],
  // add `as const` here to enforce label names
  labelNames: ["connectionId", "functionId"] as const,
});

//cache compiled udfs for 5min
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

export function buildFunctionChain(
  connection: EnrichedConnectionConfig,
  funcStore: EntityStore<FunctionConfig>,
  rotorContext: MessageHandlerContext,
  anonymousEventsStore: AnonymousEventsStore,
  fetchTimeoutMs: number = 5000
): FuncChain {
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
  let store = rotorContext.dummyPersistentStore;
  if (!store) {
    store = createMongoStore(
      connection.workspaceId,
      mongodb(),
      false,
      fastStoreWorkspaceId.includes(connection.workspaceId)
    );
    if (rotorContext.redisClient) {
      store = createMultiStore(store, createTtlStore(connection.workspaceId, rotorContext.redisClient));
    }
  }
  const chainCtx: FunctionChainContext = {
    fetch: makeFetch(connection.id, rotorContext.eventsLogger, connectionData.fetchLogLevel || "info", fetchTimeoutMs),
    log: makeLog(connection.id, rotorContext.eventsLogger),
    store,
    anonymousEventsStore,
    connectionOptions: connectionData,
  };

  const udfFuncs: FunctionConfig[] = (connectionData?.functions || [])
    .filter(f => f.functionId.startsWith("udf."))
    .map(f => {
      const functionId = f.functionId.substring(4);
      const userFunctionObj = funcStore.getObject(functionId);
      if (!userFunctionObj || userFunctionObj.workspaceId !== connection.workspaceId) {
        return {
          id: functionId as string,
          code: `export default async function (event,ctx) {
            throw newError(\`Function ${functionId} not found in workspace: ${connection.workspaceId}\`);
          }`,
          codeHash: "0",
        };
      }
      return userFunctionObj;
    });
  let cached: any;
  let hash: any[];
  if (udfFuncs.length > 0) {
    hash = udfFuncs.map(f => f.codeHash);
    hash.push(connection.updatedAt);
    cached = udfCache.get(connection.id);
    if (!cached || !isEqual(cached?.hash, hash)) {
      log.atInfo().log(`UDF for connection ${connection.id} changed (hash ${hash} != ${cached?.hash}). Reloading`);
      const wrapper = UDFWrapper(
        connection.id,
        chainCtx,
        {
          function: {
            id: "PIPELINE",
            type: "udf",
            debugTill: connectionData.debugTill ? new Date(connectionData.debugTill) : undefined,
          },
          props: {},
        },
        udfFuncs.map(f => ({ id: f.id, name: f.name, code: f.code }))
      );
      const oldWrapper = cached?.wrapper;
      if (oldWrapper) {
        setTimeout(() => {
          oldWrapper.close();
        }, 10000);
      }
      cached = { wrapper, hash };
      udfCache.set(connection.id, cached);
    }
    udfCache.ttl(connection.id, udfTTL);
  }
  const aggregatedFunctions: any[] = [
    ...(connectionData.functions || []).filter(f => f.functionId.startsWith("builtin.transformation.")),
    ...(udfFuncs.length > 0 ? [{ functionId: "udf.PIPELINE" }] : []),
    mainFunction,
  ];

  const udfPipelineFunc = (chainCtx: FunctionChainContext, funcCtx: FunctionContext): JitsuFunctionWrapper => {
    return async (event: AnyEvent, ctx: EventContext) => {
      try {
        return await cached.wrapper.userFunction(event, ctx);
      } catch (e: any) {
        if ((e?.message ?? "").includes("Isolate is disposed")) {
          // due to async nature other 'thread' could already replace this isolate. So check it
          if (cached.wrapper.isDisposed()) {
            log.atError().log(`UDF for con:${connection.id} VM was disposed. Reloading`);
            const wrapper = UDFWrapper(
              connection.id,
              chainCtx,
              funcCtx,
              udfFuncs.map(f => ({ id: f.id, name: f.name, code: f.code }))
            );
            cached = { wrapper, hash };
            udfCache.set(connection.id, cached);
            return wrapper.userFunction(event, ctx);
          } else {
            // we have alive isolate now. try again
            return await cached.wrapper.userFunction(event, ctx);
          }
        } else {
          throw e;
        }
      }
    };
  };

  const funcs: Func[] = aggregatedFunctions.map(f => {
    const ar = f.functionId.split(".");
    const id = ar.pop();
    const type = ar.join(".");
    const funcCtx: FunctionContext = {
      function: {
        id,
        type,
        debugTill: connectionData.debugTill ? new Date(connectionData.debugTill) : undefined,
      },
      props: f.functionOptions || {},
    };
    if (f.functionId.startsWith("builtin.")) {
      return {
        id: f.functionId as string,
        context: funcCtx,
        exec: wrapperFunction(
          chainCtx,
          funcCtx,
          requireDefined(getBuiltinFunction(f.functionId), `Unknown function ${f.functionId}`)
        ),
      } as Func;
    } else if (f.functionId === "udf.PIPELINE") {
      return {
        id: f.functionId as string,
        context: funcCtx,
        exec: udfPipelineFunc(chainCtx, funcCtx),
      };
    } else {
      throw newError(`Function of unknown type: ${f.functionId}`);
    }
  });

  return {
    functions: funcs,
    context: chainCtx,
  };
}

export async function runChain(
  chain: FuncChain,
  event: AnyEvent,
  eventContext: EventContext,
  metricsMeta: MetricsMeta,
  runFuncs: FuncChainFilter = "all",
  retriesEnabled: boolean = true
): Promise<FuncChainResult> {
  const execLog: FunctionExecLog = [];
  let events = [event];
  for (const f of chain.functions) {
    switch (runFuncs) {
      case "udf-n-dst":
        if (f.id !== "udf.PIPELINE" && !f.id.startsWith("builtin.destination.")) {
          continue;
        }
        break;
      case "dst-only":
        if (!f.id.startsWith("builtin.destination.")) {
          continue;
        }
        break;
    }
    const newEvents: AnyEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      functionsInFlight.inc({ connectionId: eventContext.connection?.id ?? "", functionId: f.id });
      const event = events[i];
      let result: FuncReturn = undefined;
      const sw = stopwatch();
      const rat = new Date(event.receivedAt) as any;
      const execLogMeta = {
        eventIndex: i,
        receivedAt: rat && rat != "Invalid Date" ? rat : new Date(),
        functionId: f.id,
        metricsMeta: metricsMeta,
      };
      try {
        result = await f.exec(event, eventContext);
        const ms = sw.elapsedMs();
        functionsTime.observe({ connectionId: eventContext.connection?.id ?? "", functionId: f.id }, ms);
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
        functionsTime.observe({ connectionId: eventContext.connection?.id ?? "", functionId: f.id }, ms);
        const args = [err?.name, err?.message];
        const r = retriesEnabled ? retryObject(err, eventContext.retries ?? 0) : undefined;
        if (r) {
          args.push(r);
        }
        if (r?.retry?.left ?? 0 > 0) {
          chain.context.log.warn(f.context, `Function execution failed`, ...args);
        } else {
          chain.context.log.error(f.context, `Function execution failed`, ...args);
        }
        if (f.id === "udf.PIPELINE") {
          if (err.name !== DropRetryErrorName && err.event) {
            // if udf pipeline failed  w/o drop error pass partial result of pipeline to the destination function
            newEvents.push(...(Array.isArray(err.event) ? err.event : [err.event]));
            continue;
          }
        }
      } finally {
        functionsInFlight.dec({ connectionId: eventContext.connection?.id ?? "", functionId: f.id });
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
