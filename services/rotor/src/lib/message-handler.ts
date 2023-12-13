import { getLog, newError, requireDefined } from "juava";
import { Metrics } from "./metrics";
import { GeoResolver } from "./maxmind";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { CONNECTION_IDS_HEADER } from "./rotor";
import { fastStore } from "@jitsu-internal/console/lib/server/fast-store";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { AnyEvent, EventContext, FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import {
  createMultiStore,
  createOldStore,
  createTtlStore,
  defaultTTL,
  getBuiltinFunction,
  MetricsMeta,
  mongoAnonymousEventsStore,
  parseUserAgent,
  SystemContext,
  UDFWrapper,
} from "@jitsu/core-functions";
import { redis } from "@jitsu-internal/console/lib/server/redis";
import { redisLogger } from "./redis-logger";
import { checkError, FuncChain, runChain } from "./functions-chain";
import NodeCache from "node-cache";
import hash from "object-hash";
import pick from "lodash/pick";

export const log = getLog("rotor");
//cache connections for 20sec
const connectionsCache = new NodeCache({ stdTTL: 20, checkperiod: 60, useClones: false });
//cache functions for 20sec
const functionsCache = new NodeCache({ stdTTL: 20, checkperiod: 60, useClones: false });
//cache compiled udfs for 10min (ttl is extended on each access)
const udfTTL = 60 * 10;
const udfCache = new NodeCache({ stdTTL: udfTTL, checkperiod: 60, useClones: false });
udfCache.on("del", (key, value) => {
  log.atInfo().log(`UDF ${key} deleted from cache`);
  value.wrapper?.close();
});
const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");

const getCachedOrLoad = async (cache: NodeCache, key: string, loader: (key: string) => Promise<any>) => {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const loaded = await loader(key);
  cache.set(key, loaded);
  return loaded;
};

export async function rotorMessageHandler(
  _message: string | object | undefined,
  headers?,
  metrics?: Metrics,
  geoResolver?: GeoResolver,
  functionsFilter?: (id: string) => boolean,
  retries: number = 0
) {
  if (!_message) {
    return;
  }
  const message = (typeof _message === "string" ? JSON.parse(_message) : _message) as IngestMessage;
  const connectionId =
    headers && headers[CONNECTION_IDS_HEADER] ? headers[CONNECTION_IDS_HEADER].toString() : message.connectionId;
  const connection = requireDefined(
    await getCachedOrLoad(connectionsCache, connectionId, fastStore.getEnrichedConnection),
    `Unknown connection: ${connectionId}`
  );

  log
    .atDebug()
    .log(
      `Processing ${message.type} Message ID: ${message.messageId} for: ${connection.id} (${connection.streamId} → ${connection.destinationId}(${connection.type}))`
    );

  const event = message.httpPayload as AnalyticsServerEvent;
  const geo =
    Object.keys(event.context.geo || {}).length > 0
      ? event.context.geo
      : geoResolver && event.context?.ip
      ? await geoResolver.resolve(event.context?.ip)
      : undefined;
  event.context.geo = geo;
  const ctx: EventContext = {
    headers: message.httpHeaders,
    geo: geo,
    ua: parseUserAgent(event.context?.userAgent),
    retries,
    source: {
      type: message.ingestType,
      id: connection.streamId,
      domain: message.origin?.domain,
    },
    destination: {
      id: connection.destinationId,
      type: connection.type,
      updatedAt: connection.updatedAt,
      hash: connection.credentialsHash,
    },
    connection: {
      id: connection.id,
      mode: connection.mode,
      options: connection.options,
    },
  };
  const oldStore = createOldStore(connection.id, redis());
  const ttlStore = createTtlStore(connection.workspaceId, redis(), defaultTTL);
  const store = createMultiStore(ttlStore, oldStore);

  const rl = await redisLogger.waitInit();

  const connectionData = connection.options as any;

  let mainFunction;
  if (connection.usesBulker) {
    mainFunction = {
      functionId: "builtin.destination.bulker",
      functionOptions: {
        bulkerEndpoint: bulkerBase,
        destinationId: connectionId,
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
  const functions = [...(connectionData.functions || []), mainFunction].filter(f =>
    functionsFilter ? functionsFilter(f.functionId) : true
  );
  const metricsMeta: MetricsMeta = {
    workspaceId: connection.workspaceId,
    messageId: message.messageId,
    streamId: connection.streamId,
    destinationId: connection.destinationId,
    connectionId: connection.id,
    retries,
  };
  //system context for builtin functions only
  const systemContext: SystemContext = {
    $system: {
      anonymousEventsStore: mongoAnonymousEventsStore(),
      metricsMeta,
      store: ttlStore,
    },
  };
  const udfFuncChain: FuncChain = await Promise.all(
    functions
      .filter(f => f.functionId.startsWith("udf."))
      .map(async f => {
        const functionId = f.functionId.substring(4);
        const userFunctionObj = await getCachedOrLoad(functionsCache, functionId, key => {
          return fastStore.getConfig("function", key);
        });
        if (!userFunctionObj || userFunctionObj.workspaceId !== connection.workspaceId) {
          return {
            id: f.functionId as string,
            config: {},
            exec: async (event, ctx) => {
              throw newError(`Function ${functionId} not found in workspace: ${connection.workspaceId}`);
            },
            context: {},
          };
        }
        const code = userFunctionObj.code;
        const codeHash = hash(code);
        let cached = await getCachedOrLoad(udfCache, functionId, async key => {
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
          context: {},
        };
      })
  );
  const aggregatedFunctions: any[] = [
    ...functions.filter(f => f.functionId.startsWith("builtin.transformation.")),
    ...(udfFuncChain.length > 0 ? [{ functionId: "udf.PIPELINE" }] : []),
    ...functions.filter(f => f.functionId.startsWith("builtin.destination.")),
  ];

  const udfPipelineFunc = async (event: AnyEvent, ctx: FullContext) => {
    const chainRes = await runChain(
      udfFuncChain,
      event,
      rl,
      store,
      pick(ctx, ["geo", "ua", "headers", "source", "destination", "connection", "retries"])
    );
    checkError(chainRes);
    return chainRes.events;
  };

  const funcChain: FuncChain = await Promise.all(
    aggregatedFunctions
      .filter(f => (functionsFilter ? functionsFilter(f.functionId) : true))
      .map(async f => {
        if (f.functionId.startsWith("builtin.")) {
          return {
            id: f.functionId as string,
            config: f.functionOptions as any,
            exec: requireDefined(getBuiltinFunction(f.functionId), `Unknown function ${f.functionId}`) as JitsuFunction,
            context: systemContext,
          };
        } else if (f.functionId === "udf.PIPELINE") {
          return {
            id: f.functionId as string,
            config: {},
            exec: udfPipelineFunc,
            context: systemContext,
          };
        } else {
          throw newError(`Function of unknown type: ${f.functionId}`);
        }
      })
  );
  const chainRes = await runChain(funcChain, event, rl, store, ctx);
  chainRes.connectionId = connectionId;
  await metrics?.logMetrics(chainRes.execLog);
  checkError(chainRes);
  return chainRes;
}
