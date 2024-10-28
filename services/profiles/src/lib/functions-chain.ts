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
  Profile,
  ProfileBuilder,
  ProfileFunctionWrapper,
  ProfileUDFWrapper,
  ProfileUser,
} from "@jitsu/core-functions";

import { getLog, newError } from "juava";
import NodeCache from "node-cache";
import isEqual from "lodash/isEqual";
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

//cache compiled udfs for 10min
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
  const pbLongId = `${profileBuilder.workspaceId}-${profileBuilder.id}-v${profileBuilder.version}`;
  const store = createMongoStore(profileBuilder.workspaceId, mongodb(), false, true);

  const chainCtx: FunctionChainContext = {
    fetch: makeFetch(profileBuilder.id, eventsLogger, "info", fetchTimeoutMs),
    log: makeLog(profileBuilder.id, eventsLogger, true),
    store,
  };
  const funcCtx = {
    function: {
      id: "profile-builder",
      type: "udf",
      debugTill: profileBuilder.debugTill ? new Date(profileBuilder.debugTill) : undefined,
    },
    props: profileBuilder.connectionOptions?.variables || {},
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
    throw newError(`No UDF functions found for profile builder ${pbLongId}`);
  }
  let cached: any;
  let hash: any[];
  hash = udfFuncs.map(f => f.codeHash);
  hash.push(profileBuilder.updatedAt);
  cached = udfCache.get(pbLongId);
  if (!cached || !isEqual(cached?.hash, hash)) {
    log.atInfo().log(`UDF for connection ${pbLongId} changed (hash ${hash} != ${cached?.hash}). Reloading`);
    const wrapper = ProfileUDFWrapper(
      pbLongId,
      chainCtx,
      funcCtx,
      udfFuncs.map(f => ({ id: f.id, name: f.name, code: f.code }))
    );
    const oldWrapper = cached?.wrapper;
    if (oldWrapper) {
      setTimeout(() => {
        oldWrapper.close();
      }, 10000);
    }
    cached = { wrapper, hash };
    udfCache.set(pbLongId, cached);
  }
  udfCache.ttl(pbLongId, udfTTL);

  const udfPipelineFunc = (chainCtx: FunctionChainContext, funcCtx: FunctionContext): ProfileFunctionWrapper => {
    return async (events, user, ctx) => {
      try {
        return await cached.wrapper.userFunction(events, user, ctx);
      } catch (e: any) {
        if ((e?.message ?? "").includes("Isolate is disposed")) {
          // due to async nature other 'thread' could already replace this isolate. So check it
          if (cached.wrapper.isDisposed()) {
            log.atError().log(`UDF for pb:${pbLongId} VM was disposed. Reloading`);
            const wrapper = ProfileUDFWrapper(
              pbLongId,
              chainCtx,
              funcCtx,
              udfFuncs.map(f => ({ id: f.id, name: f.name, code: f.code }))
            );
            cached = { wrapper, hash };
            udfCache.set(pbLongId, cached);
            return wrapper.userFunction(events, user, ctx);
          } else {
            // we have alive isolate now. try again
            return await cached.wrapper.userFunction(events, user, ctx);
          }
        } else {
          throw e;
        }
      }
    };
  };

  const funcs: Func[] = [
    {
      id: "udf.PIPELINE",
      context: funcCtx,
      exec: udfPipelineFunc(chainCtx, funcCtx),
    },
  ];

  return {
    functions: funcs,
    context: chainCtx,
  };
}

export async function runChain(chain: FuncChain, events: any[], user: ProfileUser): Promise<Profile | undefined> {
  const f = chain.functions[0];
  let result: ProfileResult | undefined = undefined;
  try {
    result = await f.exec(events, user, f.context);
    return {
      user_id: user.userId,
      traits: user.traits,
      custom_properties: result?.properties || {},
      updated_at: new Date(),
    };
  } catch (err: any) {
    throw newError(`Function execution failed`, err);
  }
  return undefined;
}
