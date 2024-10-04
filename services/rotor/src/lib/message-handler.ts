import { getLog, requireDefined } from "juava";
import { Metrics } from "./metrics";
import { GeoResolver } from "./maxmind";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { CONNECTION_IDS_HEADER } from "./rotor";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { EventContext, FetchType, TTLStore } from "@jitsu/protocols/functions";
import {
  MetricsMeta,
  mongoAnonymousEventsStore,
  parseUserAgent,
  EventsStore,
  ProfilesFunction,
  createDummyStore,
  ProfilesConfig,
  EntityStore,
  EnrichedConnectionConfig,
  FunctionConfig,
  Workspace,
} from "@jitsu/core-functions";
import NodeCache from "node-cache";
import { buildFunctionChain, checkError, FuncChain, FuncChainFilter, runChain } from "./functions-chain";
import { Redis } from "ioredis";
export const log = getLog("rotor");

const anonymousEventsStore = mongoAnonymousEventsStore();

//cache function chains for 1m
const funcsChainTTL = 60;
const funcsChainCache = new NodeCache({ stdTTL: funcsChainTTL, checkperiod: 60, useClones: false });

export type MessageHandlerContext = {
  connectionStore: EntityStore<EnrichedConnectionConfig>;
  functionsStore: EntityStore<FunctionConfig>;
  workspaceStore: EntityStore<Workspace>;
  eventsLogger: EventsStore;
  metrics?: Metrics;
  geoResolver?: GeoResolver;
  dummyPersistentStore?: TTLStore;
  redisClient?: Redis;
};

export function functionFilter(errorFunctionId?: string) {
  let runFuncs: FuncChainFilter = "all";
  const fid = errorFunctionId || "";
  if (fid.startsWith("udf.")) {
    runFuncs = "udf-n-dst";
  } else if (fid.startsWith("builtin.destination.")) {
    runFuncs = "dst-only";
  }
  return runFuncs;
}

export async function rotorMessageHandler(
  _message: string | object | undefined,
  rotorContext: MessageHandlerContext,
  runFuncs: FuncChainFilter = "all",
  headers?,
  retriesEnabled: boolean = true,
  retries: number = 0,
  fetchTimeoutMs: number = 2000
) {
  if (!_message) {
    return;
  }
  const connStore = rotorContext.connectionStore;
  const funcStore = rotorContext.functionsStore;
  const workspaceStore = rotorContext.workspaceStore;

  const message = (typeof _message === "string" ? JSON.parse(_message) : _message) as IngestMessage;
  const connectionId =
    headers && headers[CONNECTION_IDS_HEADER] ? headers[CONNECTION_IDS_HEADER].toString() : message.connectionId;
  const connection = requireDefined(connStore.getObject(connectionId), `Unknown connection: ${connectionId}`);

  log.inDebug(l =>
    l.log(
      `Processing ${message.type} Message ID: ${message.messageId} for: ${connection.id} (${connection.streamId} → ${connection.destinationId}(${connection.type}))`
    )
  );

  const event = message.httpPayload as AnalyticsServerEvent;
  if (!event.context) {
    event.context = {};
  }
  const geo =
    Object.keys(event.context.geo || {}).length > 0
      ? event.context.geo
      : rotorContext.geoResolver && event.context.ip
      ? await rotorContext.geoResolver.resolve(event.context.ip)
      : undefined;
  if (geo) {
    event.context.geo = geo;
  }
  const ctx: EventContext = {
    headers: message.httpHeaders,
    geo: geo,
    ua: parseUserAgent(event.context.userAgent),
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
      options: connection.options,
    },
    workspace: {
      id: connection.workspaceId,
    },
  };

  const metricsMeta: MetricsMeta = {
    workspaceId: connection.workspaceId,
    messageId: message.messageId,
    streamId: connection.streamId,
    destinationId: connection.destinationId,
    connectionId: connection.id,
    retries,
  };

  let lastUpdated = Math.max(
    new Date(connection.updatedAt || 0).getTime(),
    (funcStore.lastModified || new Date(0)).getTime()
  );
  const cacheKey = `${connection.id}_${lastUpdated}`;
  let funcChain: FuncChain | undefined = funcsChainCache.get(cacheKey);
  if (!funcChain) {
    log.atDebug().log(`[${connection.id}] Refreshing function chain. Dt: ${lastUpdated}`);
    funcChain = buildFunctionChain(connection, funcStore, rotorContext, anonymousEventsStore, fetchTimeoutMs);
    funcsChainCache.set(cacheKey, funcChain);
  }

  if (retries === 0) {
    await profilesHandler(rotorContext, ctx, connection, event);
  }

  const chainRes = await runChain(funcChain, event, ctx, metricsMeta, runFuncs, retriesEnabled);
  chainRes.connectionId = connectionId;
  rotorContext.metrics?.logMetrics(chainRes.execLog);
  checkError(chainRes);
  return chainRes;
}

async function profilesHandler(
  rotorContext: MessageHandlerContext,
  ctx: EventContext,
  connection: EnrichedConnectionConfig,
  event: AnalyticsServerEvent
) {
  const wp = rotorContext.workspaceStore.getObject(connection.workspaceId);
  if (wp) {
    const builders = wp.profileBuilders.filter(p => p.destinationId === connection.destinationId);
    for (const builder of builders) {
      const flog = getLog(`profile-builder-${connection.workspaceId}-${builder.id}`);
      try {
        await ProfilesFunction(event, {
          ...ctx,
          props: builder.intermediateStorageCredentials as ProfilesConfig,
          store: createDummyStore(),
          log: {
            error: (msg, args) => flog.atError().log(msg, ...(args || [])),
            info: (msg, args) => flog.atInfo().log(msg, ...(args || [])),
            debug: (msg, args) => flog.atDebug().log(msg, ...(args || [])),
            warn: (msg, args) => flog.atWarn().log(msg, ...(args || [])),
          },
          fetch: fetch as FetchType,
        });
      } catch (e: any) {
        flog.atError().log("Failed to store event: " + e.message);
      }
    }
  }
}
