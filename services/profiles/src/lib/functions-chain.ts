import {
  createMongoStore,
  EntityStore,
  EventsStore,
  FunctionChainContext,
  FunctionConfig,
  FunctionContext,
  makeFetch,
  makeLog,
  MetricsMeta,
  mongodb,
  ProfileBuilder,
} from "@jitsu/core-functions";

import { getLog, newError } from "juava";
import NodeCache from "node-cache";
import isEqual from "lodash/isEqual";
import { ProfileFunctionWrapper, ProfileUser, UDFWrapper } from "./profiles-udf-wrapper";
import { ProfileResult } from "@jitsu/protocols/profile";

export type Func = {
  id: string;
  exec: ProfileFunctionWrapper;
  context: FunctionContext;
  hash?: string;
};

export type FuncChain = {
  context: FunctionChainContext;
  functions: Func[];
};

const log = getLog("functions-chain");

//cache compiled udfs for 5min
const udfTTL = 60 * 10;
const udfCache = new NodeCache({ stdTTL: udfTTL, checkperiod: 60, useClones: false });
udfCache.on("del", (key, value) => {
  log.atInfo().log(`UDF ${key} deleted from cache`);
  value.wrapper?.close();
});

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

export function buildFunctionChain(
  profileBuilder: ProfileBuilder,
  funcStore: EntityStore<FunctionConfig>,
  eventsLogger: EventsStore,
  fetchTimeoutMs: number = 2000
): FuncChain {
  const store = createMongoStore(profileBuilder.workspaceId, mongodb(), false, true);

  const chainCtx: FunctionChainContext = {
    fetch: makeFetch(profileBuilder.id, eventsLogger, "info", fetchTimeoutMs),
    log: makeLog(profileBuilder.id, eventsLogger, true),
    store,
  };

  const udfFuncs: FunctionConfig[] = (profileBuilder.functions || []).map(f => {
    const functionId = f.functionId;
    const userFunctionObj = funcStore.getObject(functionId);
    if (!userFunctionObj || userFunctionObj.workspaceId !== profileBuilder.workspaceId) {
      throw newError(`Function ${functionId} not found in workspace: ${profileBuilder.workspaceId}`);
    }
    return userFunctionObj;
  });
  if (udfFuncs.length === 0) {
    throw newError(`No UDF functions found for profile builder ${profileBuilder.id}`);
  }
  let cached: any;
  let hash: any[];
  hash = udfFuncs.map(f => f.codeHash);
  hash.push(profileBuilder.updatedAt);
  cached = udfCache.get(profileBuilder.id);
  if (!cached || !isEqual(cached?.hash, hash)) {
    log.atInfo().log(`UDF for connection ${profileBuilder.id} changed (hash ${hash} != ${cached?.hash}). Reloading`);
    const wrapper = UDFWrapper(
      profileBuilder.id,
      chainCtx,
      {
        function: {
          id: "profile-builder",
          type: "udf",
          debugTill: profileBuilder.debugTill ? new Date(profileBuilder.debugTill) : undefined,
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
    udfCache.set(profileBuilder.id, cached);
  }
  udfCache.ttl(profileBuilder.id, udfTTL);

  const udfPipelineFunc = (chainCtx: FunctionChainContext, funcCtx: FunctionContext): ProfileFunctionWrapper => {
    return async (ctx, events, user) => {
      try {
        return await cached.wrapper.userFunction(ctx, events, user);
      } catch (e: any) {
        if ((e?.message ?? "").includes("Isolate is disposed")) {
          // due to async nature other 'thread' could already replace this isolate. So check it
          if (cached.wrapper.isDisposed()) {
            log.atError().log(`UDF for pb:${profileBuilder.id} VM was disposed. Reloading`);
            const wrapper = UDFWrapper(
              profileBuilder.id,
              chainCtx,
              funcCtx,
              udfFuncs.map(f => ({ id: f.id, name: f.name, code: f.code }))
            );
            cached = { wrapper, hash };
            udfCache.set(profileBuilder.id, cached);
            return wrapper.userFunction(ctx, events, user);
          } else {
            // we have alive isolate now. try again
            return await cached.wrapper.userFunction(ctx, events, user);
          }
        } else {
          throw e;
        }
      }
    };
  };

  const funcCtx = {
    function: {
      id: "profile-builder",
      type: "udf",
      debugTill: profileBuilder.debugTill ? new Date(profileBuilder.debugTill) : undefined,
    },
    props: {},
  };

  const funcs: Func[] = [
    {
      id: "udf.PIPILINE",
      context: funcCtx,
      exec: udfPipelineFunc(chainCtx, funcCtx),
    },
  ];

  return {
    functions: funcs,
    context: chainCtx,
  };
}

export async function runChain(chain: FuncChain, events: any[], user: ProfileUser): Promise<ProfileResult | undefined> {
  const f = chain.functions[0];
  let result: ProfileResult | undefined = undefined;
  try {
    result = await f.exec(f.context, events, user);
  } catch (err: any) {
    throw newError(`Function execution failed`, err);
  }
  return result;
}
