import { getLog, newError, requireDefined } from "juava";
import { Metrics } from "./metrics";
import { GeoResolver } from "./maxmind";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { CONNECTION_IDS_HEADER } from "./rotor";
import { EntityStore } from "./entity-store";

import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { EventContext, Store, TTLStore } from "@jitsu/protocols/functions";
import {
  createMongoStore,
  mongodb,
  MetricsMeta,
  mongoAnonymousEventsStore,
  parseUserAgent,
  SystemContext,
  EventsStore,
} from "@jitsu/core-functions";
import NodeCache from "node-cache";
import { buildFunctionChain, checkError, FuncChain, FuncChainFilter, runChain } from "./functions-chain";
import { EnrichedConnectionConfig, FunctionConfig } from "./config-types";
export const log = getLog("rotor");

const anonymousEventsStore = mongoAnonymousEventsStore();
const fastStoreWorskpaceId = (process.env.FAST_STORE_WORKSPACE_ID ?? "").split(",").filter(x => x.length > 0);

//cache function chains for 1m
const funcsChainTTL = 60;
const funcsChainCache = new NodeCache({ stdTTL: funcsChainTTL, checkperiod: 60, useClones: false });

export type MessageHandlerContext = {
  connectionStore: EntityStore<EnrichedConnectionConfig>;
  functionsStore: EntityStore<FunctionConfig>;
  eventsLogger: EventsStore;
  metrics?: Metrics;
  geoResolver?: GeoResolver;
  dummyPersistentStore?: TTLStore;
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
  retries: number = 0,
  fetchTimeoutMs: number = 5000
) {
  if (!_message) {
    return;
  }
  const connStore = rotorContext.connectionStore;
  const funcStore = rotorContext.functionsStore;
  const eventStore = rotorContext.eventsLogger;

  const message = (typeof _message === "string" ? JSON.parse(_message) : _message) as IngestMessage;
  const connectionId =
    headers && headers[CONNECTION_IDS_HEADER] ? headers[CONNECTION_IDS_HEADER].toString() : message.connectionId;
  const connection = requireDefined(connStore.getObject(connectionId), `Unknown connection: ${connectionId}`);

  log
    .atDebug()
    .log(
      `Processing ${message.type} Message ID: ${message.messageId} for: ${connection.id} (${connection.streamId} → ${connection.destinationId}(${connection.type}))`
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
  };

  const metricsMeta: MetricsMeta = {
    workspaceId: connection.workspaceId,
    messageId: message.messageId,
    streamId: connection.streamId,
    destinationId: connection.destinationId,
    connectionId: connection.id,
    retries,
  };
  const store =
    rotorContext.dummyPersistentStore ||
    createMongoStore(connection.workspaceId, mongodb(), fastStoreWorskpaceId.includes(connection.workspaceId));
  //system context for builtin functions only
  const systemContext: SystemContext = {
    $system: {
      anonymousEventsStore: anonymousEventsStore,
      metricsMeta,
      store,
      eventsStore: eventStore,
    },
  };

  let lastUpdated = Math.max(
    new Date(connection.updatedAt || 0).getTime(),
    (funcStore.lastModified || new Date(0)).getTime()
  );
  const cacheKey = `${connection.id}_${lastUpdated}`;
  let funcChain: FuncChain | undefined = funcsChainCache.get(cacheKey);
  if (!funcChain) {
    funcChain = buildFunctionChain(connection, funcStore);
    funcsChainCache.set(cacheKey, funcChain);
  }

  const chainRes = await runChain(funcChain, event, eventStore, store, ctx, runFuncs, systemContext, fetchTimeoutMs);
  chainRes.connectionId = connectionId;
  rotorContext.metrics?.logMetrics(chainRes.execLog);
  checkError(chainRes);
  return chainRes;
}
