import {
  AnonymousEventsStore,
  AnyEvent,
  EventContext,
  FuncReturn,
  JitsuFunction,
  TTLStore,
} from "@jitsu/protocols/functions";
import {
  createDummyStore,
  createMultiStore,
  EnrichedConnectionConfig,
  EntityStore,
  FuncChainResult,
  FunctionChainContext,
  FunctionContext,
  FunctionExecLog,
  FunctionExecRes,
  getBuiltinFunction as _getBuiltinFunction,
  isDropResult,
  JitsuFunctionWrapper,
  makeFetch,
  makeLog,
  MetricsMeta,
  UserRecognitionParameter,
  wrapperFunction,
  EventsStore,
} from "@jitsu/destination-functions";
import { NoRetryErrorName, DropRetryErrorName } from "@jitsu/functions-lib";

import { getLog, newError, requireDefined, stopwatch } from "juava";
import { retryObject } from "./retries";
import { MessageHandlerContext } from "./message-handler";
import { promFunctionsChainStatuses, promChainsInFlight, promChainsTime } from "./metrics";
import { getServerEnv } from "../serverEnv";
import { ProfilesFunction } from "./profiles-functions";
import { createMongoStore, mongodb } from "./mongodb";
import { createRedisStore } from "./store";
import { warehouseQuery } from "./warehouse-store";
import { MongodbDestination } from "./mongodb-destination";
import { createFunctionsServerWrapper } from "./functions-server-client";

const serverEnv = getServerEnv();
const fastStoreWorkspaceId = (serverEnv.FAST_STORE_WORKSPACE_ID ?? "").split(",").filter(x => x.length > 0);

function getBuiltinFunction(id: string): JitsuFunction | undefined {
  if (id === "builtin.destination.profiles") {
    return ProfilesFunction as JitsuFunction;
  }
  if (id === "builtin.destination.mongodb") {
    return MongodbDestination as JitsuFunction;
  }
  return _getBuiltinFunction(id);
}

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
const bulkerBase = requireDefined(serverEnv.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(serverEnv.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");

export function checkError(chainRes: FuncChainResult) {
  for (const el of chainRes.execLog) {
    if (el.error) {
      // throw retry errors above to schedule retry
      const err = el.error;
      err.event = el.event;
      err.functionId = err.functionId || el.functionId;
      throw err;
    }
  }
}

export function buildFunctionChain(
  skipUdf: boolean,
  connection: EnrichedConnectionConfig,
  connStore: EntityStore<EnrichedConnectionConfig>,
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

    if (serverEnv.MONGODB_URL) {
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
    metrics: {
      status(component: string, status: "error" | "ok", errorType: string = ""): { inc: (value: number) => void } {
        return {
          inc: (value: number) => {
            promFunctionsChainStatuses.labels({ connectionId: conId, component, status, errorType }).inc(value);
          },
        };
      },
    },
    connectionOptions: connectionData,
  };

  // Check if there are any UDF functions configured
  const udfFunctionRefs = (connectionData?.functions || []).filter((f: any) => f.functionId.startsWith("udf."));
  const runUdfFunctions = !skipUdf && udfFunctionRefs.length > 0;

  const aggregatedFunctions: any[] = [
    ...(connectionData.functions || []).filter((f: any) => f.functionId.startsWith("builtin.transformation.")),
    ...(runUdfFunctions ? [{ functionId: "udf.PIPELINE" }] : []),
    mainFunction,
  ];

  // All UDF execution is delegated to the Deno-based functions-server.
  const functionsServerDeploymentId = connectionData.functionsServer?.deploymentId;
  const functionsServerPipelineFunc = (
    chainCtx: FunctionChainContext,
    funcCtx: FunctionContext,
    eventsLogger: EventsStore
  ): JitsuFunctionWrapper => {
    const wrapper = createFunctionsServerWrapper(
      functionsServerDeploymentId,
      conId,
      chainCtx,
      funcCtx,
      eventsLogger,
      fetchTimeoutMs
    );
    return async (event: AnyEvent, ctx: EventContext) => {
      return await wrapper(event, ctx);
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
        exec: functionsServerPipelineFunc(chainCtx, funcCtx, rotorContext.eventsLogger),
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
  promChainsInFlight.inc();
  const chainSw = stopwatch();
  try {
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
          if (err.name === DropRetryErrorName || err.name === NoRetryErrorName) {
            result = "drop";
          }
          execLogEvent.event = event;
          execLogEvent.error = err;
          const args = [err?.name, err?.message];
          const r = retriesEnabled ? retryObject(err, eventContext.retries ?? 0) : undefined;
          if (r) {
            args.push(r);
          }
          const fctx = { ...f.context };
          if (err.functionId) {
            fctx.function.id = err.functionId;
            fctx.function.type = "udf";
          }
          if (r?.retry?.left ?? 0 > 0) {
            chain.context.log.warn(f.context, `Function execution failed`, ...args);
          } else {
            chain.context.log.error(f.context, `Function execution failed`, ...args);
          }
          if (f.id === "udf.PIPELINE") {
            if (err.name !== DropRetryErrorName && err.name !== NoRetryErrorName) {
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
          execLogEvent.ms = sw.elapsedMs();
          execLogEvent.dropped = isDropResult(result);
          execLog.push(execLogEvent as FunctionExecRes);
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
  } finally {
    promChainsTime.observe(chainSw.elapsedMs());
    promChainsInFlight.dec();
  }
  return { events, execLog };
}
