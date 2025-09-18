import { AnonymousEventsStore, AnyEvent, EventContext, FuncReturn, TTLStore } from "@jitsu/protocols/functions";
import {
  createDummyStore,
  createMongoStore,
  createMultiStore,
  createRedisStore,
  EnrichedConnectionConfig,
  EntityStore,
  FuncChainResult,
  FunctionChainContext,
  FunctionConfig,
  FunctionContext,
  FunctionExecLog,
  FunctionExecRes,
  getBuiltinFunction,
  isDropResult,
  JitsuFunctionWrapper,
  makeFetch,
  makeLog,
  MetricsMeta,
  mongodb,
  UDFWrapper,
  UserRecognitionParameter,
  warehouseQuery,
  wrapperFunction,
} from "@jitsu/core-functions";
import { DropRetryErrorName, RetryErrorName } from "@jitsu/functions-lib";

import { getLog, newError, requireDefined, stopwatch } from "juava";
import { retryObject } from "./retries";
import NodeCache from "node-cache";
import isEqual from "lodash/isEqual";
import { MessageHandlerContext } from "./message-handler";
import { promFunctionsInFlight, promFunctionsTime } from "./metrics";

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

//cache compiled udfs for 5min
const udfTTL = 60 * 10;
const udfCache = new NodeCache({ stdTTL: udfTTL, checkperiod: 60, useClones: false });
udfCache.on("del", (key, value) => {
  log.atDebug().log(`UDF ${key} deleted from cache`);
  value.wrapper?.close();
});

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
  connStore: EntityStore<EnrichedConnectionConfig>,
  funcStore: EntityStore<FunctionConfig>,
  rotorContext: MessageHandlerContext,
  anonymousEventsStore: AnonymousEventsStore,
  fetchTimeoutMs: number = 2000
): FuncChain {
  let mainFunction;
  const connectionData = connection.options as any;
  const conId = connection.id;
  const conWorkspaceId = connection.workspaceId;
  if (connection.usesBulker) {
    mainFunction = {
      functionId: "builtin.destination.bulker",
      functionOptions: {
        bulkerEndpoint: bulkerBase,
        destinationId: conId,
        authToken: bulkerAuthKey,
        dataLayout: connectionData.dataLayout ?? "segment-single-table",
        keepOriginalNames: connectionData.keepOriginalNames,
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
        `Connection with id ${conId} has no functions assigned to it's destination type - ${connection.type}`
      );
    }
  }
  let store: TTLStore | undefined = rotorContext.dummyPersistentStore;
  if (!store) {
    let mongodbStore: TTLStore | undefined, redisStore: TTLStore | undefined;

    if (process.env.MONGODB_URL) {
      mongodbStore = createMongoStore(
        conWorkspaceId,
        mongodb,
        false,
        fastStoreWorkspaceId.includes(conWorkspaceId),
        rotorContext.metrics
      );
    }

    if (rotorContext.redisClient) {
      redisStore = createRedisStore(conWorkspaceId, rotorContext.redisClient, rotorContext.metrics);
    }

    if (mongodbStore && redisStore) {
      store = createMultiStore(mongodbStore, redisStore);
    } else if (mongodbStore) {
      store = mongodbStore;
    } else if (redisStore) {
      store = redisStore;
    } else {
      store = createDummyStore();
      log.atWarn().log(`No persistence storage configured. MONGODB_URL or REDIS_URL environment variable is required`);
    }
  }

  const chainCtx: FunctionChainContext = {
    fetch: makeFetch(conId, rotorContext.eventsLogger, connectionData.fetchLogLevel || "info", fetchTimeoutMs),
    log: makeLog(conId, rotorContext.eventsLogger),
    store,
    query: async (conId: string, query: string, params: any) => {
      return warehouseQuery(conWorkspaceId, connStore, conId, query, params, rotorContext.metrics);
    },
    anonymousEventsStore,
    connectionOptions: connectionData,
  };
  const udfFuncCtx = {
    function: {
      id: "PIPELINE",
      type: "udf",
      debugTill: connectionData.debugTill ? new Date(connectionData.debugTill) : undefined,
    },
    props: connectionData.functionsEnv || {},
  };
  const udfFuncs: FunctionConfig[] = (connectionData?.functions || [])
    .filter(f => f.functionId.startsWith("udf."))
    .map(f => {
      const functionId = f.functionId.substring(4);
      const userFunctionObj = funcStore.getObject(functionId);
      if (!userFunctionObj || userFunctionObj.workspaceId !== conWorkspaceId) {
        return {
          id: functionId as string,
          code: `export default async function (event,ctx) {
            throw newError(\`Function ${functionId} not found in workspace: ${conWorkspaceId}\`);
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
    cached = udfCache.get(conId);
    if (!cached || !isEqual(cached?.hash, hash)) {
      log.atInfo().log(`UDF for connection ${conId} changed (hash ${hash} != ${cached?.hash}). Reloading`);
      const wrapper = UDFWrapper(
        conId,
        chainCtx,
        udfFuncCtx,
        udfFuncs.map(f => ({ id: f.id, name: f.name, code: f.code }))
      );
      const oldWrapper = cached?.wrapper;
      if (oldWrapper) {
        setTimeout(() => {
          oldWrapper.close();
        }, 10000);
      }
      cached = { wrapper, hash };
      udfCache.set(conId, cached);
    }
    udfCache.ttl(conId, udfTTL);
  }
  const aggregatedFunctions: any[] = [
    ...(connectionData.functions || []).filter(f => f.functionId.startsWith("builtin.transformation.")),
    ...(udfFuncs.length > 0 ? [{ functionId: "udf.PIPELINE" }] : []),
    mainFunction,
  ];

  const udfPipelineFunc = (chainCtx: FunctionChainContext): JitsuFunctionWrapper => {
    return async (event: AnyEvent, ctx: EventContext) => {
      try {
        return await cached.wrapper.userFunction(event, ctx);
      } catch (e: any) {
        if ((e?.message ?? "").includes("Isolate is disposed")) {
          // due to async nature other 'thread' could already replace this isolate. So check it
          if (cached.wrapper.isDisposed()) {
            log.atError().log(`UDF for con:${conId} VM was disposed. Reloading`);
            const wrapper = UDFWrapper(
              conId,
              chainCtx,
              udfFuncCtx,
              udfFuncs.map(f => ({ id: f.id, name: f.name, code: f.code }))
            );
            cached = { wrapper, hash };
            udfCache.set(conId, cached);
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
        exec: udfPipelineFunc(chainCtx),
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
    const metricsLabels = { connectionId: eventContext.connection?.id ?? "", functionId: f.id };
    const newEvents: AnyEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      promFunctionsInFlight.inc(metricsLabels);
      const event = events[i];
      let result: FuncReturn = undefined;
      const sw = stopwatch();
      const execLogEvent: Partial<FunctionExecRes> = {
        // we don't multiply active incoming metrics for events produced by user recognition
        eventIndex: event[UserRecognitionParameter] ? 0 : i,
        receivedAt: !isNaN(eventContext.receivedAt.getTime()) ? eventContext.receivedAt : new Date(),
        functionId: f.id,
        metricsMeta: metricsMeta,
      };
      try {
        result = await f.exec(event, eventContext);
      } catch (err: any) {
        if (err.name === DropRetryErrorName) {
          result = "drop";
        }
        execLogEvent.event = event;
        execLogEvent.error = err;
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
          if (err.name !== DropRetryErrorName) {
            const errEvent = err.event || event;
            // if udf pipeline failed  w/o drop error pass partial result of pipeline to the destination function
            if (Array.isArray(errEvent)) {
              newEvents.push(...errEvent);
            } else {
              newEvents.push(errEvent);
            }
            continue;
          }
        }
      } finally {
        const ms = sw.elapsedMs();
        promFunctionsTime.observe(metricsLabels, ms);
        execLogEvent.ms = ms;
        execLogEvent.dropped = isDropResult(result);
        execLog.push(execLogEvent as FunctionExecRes);
        promFunctionsInFlight.dec(metricsLabels);
      }
      if (!execLogEvent.dropped) {
        if (result) {
          if (Array.isArray(result)) {
            newEvents.push(...result);
          } else {
            // @ts-ignore
            newEvents.push(result);
          }
        } else {
          newEvents.push(event);
        }
      }
    }
    events = newEvents;
    if (events.length === 0) {
      break;
    }
  }
  return { events, execLog };
}
