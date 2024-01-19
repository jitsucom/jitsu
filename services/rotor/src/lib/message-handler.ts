import { getLog, newError, requireDefined } from "juava";
import { Metrics } from "./metrics";
import { GeoResolver } from "./maxmind";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { CONNECTION_IDS_HEADER } from "./rotor";
import { connectionsStore, functionsStore } from "./entity-store";

import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { EventContext } from "@jitsu/protocols/functions";
import {
  createMongoStore,
  mongodb,
  defaultTTL,
  MetricsMeta,
  mongoAnonymousEventsStore,
  parseUserAgent,
  SystemContext,
  createTtlStore,
} from "@jitsu/core-functions";
import { redisLogger } from "./redis-logger";
import { buildFunctionChain, checkError, runChain } from "./functions-chain";
import { redis } from "./redis";
import { EnrichedConnectionConfig } from "./config-types";
export const log = getLog("rotor");

const anonymousEventsStore = mongoAnonymousEventsStore();
const fastStoreWorskpaceId = (process.env.FAST_STORE_WORKSPACE_ID ?? "").split(",").filter(x => x.length > 0);

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
  const connStore = connectionsStore.getCurrent();
  if (!connStore || !connStore.enabled) {
    throw newError("Connection store is not enabled");
  }
  const funcStore = functionsStore.getCurrent();
  if (!funcStore || !funcStore.enabled) {
    throw newError("Functions store is not enabled");
  }
  const eventStore = redisLogger();

  const message = (typeof _message === "string" ? JSON.parse(_message) : _message) as IngestMessage;
  const connectionId =
    headers && headers[CONNECTION_IDS_HEADER] ? headers[CONNECTION_IDS_HEADER].toString() : message.connectionId;
  const connection: EnrichedConnectionConfig = requireDefined(
    connStore.getObject(connectionId),
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
  const store = process.env.MONGODB_URL
    ? createMongoStore(connection.workspaceId, mongodb(), fastStoreWorskpaceId.includes(connection.workspaceId))
    : createTtlStore(connection.workspaceId, redis(), defaultTTL);
  //system context for builtin functions only
  const systemContext: SystemContext = {
    $system: {
      anonymousEventsStore: anonymousEventsStore,
      metricsMeta,
      store,
      eventsStore: eventStore,
    },
  };

  const funcChain = buildFunctionChain(connection, funcStore, functionsFilter);

  const chainRes = await runChain(funcChain, event, eventStore, store, ctx, systemContext);
  chainRes.connectionId = connectionId;
  metrics?.logMetrics(chainRes.execLog);
  checkError(chainRes);
  return chainRes;
}
