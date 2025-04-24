import { FullContext, JitsuFunction, UserAgent } from "@jitsu/protocols/functions";
import {
  HTTPError,
  RetryError,
  transferAsSnakeCase,
  transferValueAsSnakeCase,
  transfer,
  transferValue,
  TableNameParameter,
  toJitsuClassic,
} from "@jitsu/functions-lib";
import { AnalyticsServerEvent, DataLayoutType } from "@jitsu/protocols/analytics";

import { request, Agent } from "undici";
import omit from "lodash/omit";
import { MetricsMeta } from "./lib";
import { UserRecognitionParameter } from "./user-recognition";
import { parseNumber } from "juava";

const JitsuInternalProperties = [TableNameParameter, UserRecognitionParameter];

const concurrency = parseNumber(process.env.CONCURRENCY, 10);
const fetchTimeoutMs = parseNumber(process.env.FETCH_TIMEOUT_MS, 2000);

export const undiciAgent = new Agent({
  connections: concurrency, // Limit concurrent kept-alive connections to not run out of resources
  maxRequestsPerClient: 3000,
  headersTimeout: fetchTimeoutMs,
  connectTimeout: fetchTimeoutMs,
  bodyTimeout: fetchTimeoutMs,
});

export type MappedEvent = {
  event: any;
  table: string;
};
export type DataLayoutImpl<T> = (
  event: AnalyticsServerEvent,
  ctx: FullContext<BulkerDestinationConfig>
) => MappedEvent[] | MappedEvent;

export function jitsuLegacy(event: AnalyticsServerEvent, ctx: FullContext<BulkerDestinationConfig>): MappedEvent {
  const flat = toJitsuClassic(event, ctx);
  return { event: omit(flat, JitsuInternalProperties), table: event[TableNameParameter] ?? "events" };
}

export function segmentLayout(
  event: AnalyticsServerEvent,
  singleTable: boolean,
  ctx: FullContext<BulkerDestinationConfig>
): MappedEvent[] | MappedEvent {
  let transformed: any;
  //track without properties for segment multi-table layout, because full track event is stored in the table with event name
  let baseTrackFlat: any;
  const keepOriginalNames = !!ctx.props.keepOriginalNames;
  const transferFunc = keepOriginalNames ? transfer : transferAsSnakeCase;
  const transferValueFunc = keepOriginalNames ? transferValue : transferValueAsSnakeCase;
  switch (event.type) {
    case "identify":
      if (singleTable) {
        transformed = {
          context: {
            traits: {},
          },
        };
        transferFunc(transformed.context, event.context, ["groupId", "traits"]);
        transferFunc(transformed.context.traits, event.context?.traits, ["groupId"]);
        transferFunc(transformed.context.traits, event.traits, ["groupId"]);
        transferValueFunc(
          transformed.context,
          "group_id",
          event.context?.groupId || event.traits?.groupId || event.context?.traits?.groupId
        );
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event, ["context", "properties", "traits", "type", ...JitsuInternalProperties]);
      } else {
        transformed = {
          context: {},
        };
        transferFunc(transformed.context, event.context, ["traits"]);
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event.context?.traits);
        transferFunc(transformed, event.traits);
        transferFunc(transformed, event, ["context", "properties", "traits", "type", ...JitsuInternalProperties]);
      }
      break;
    case "group":
      if (singleTable) {
        transformed = {
          context: {
            group: {},
          },
        };
        transferFunc(transformed.context, event.context);
        transferFunc(transformed.context.group, event.traits);
        transferValueFunc(transformed.context, "group_id", event.groupId);
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event, [
          "context",
          "properties",
          "traits",
          "type",
          "groupId",
          ...JitsuInternalProperties,
        ]);
      } else {
        transformed = {
          context: {},
        };
        transferFunc(transformed.context, event.context, ["traits"]);
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event.traits);
        transferFunc(transformed, event, ["context", "properties", "traits", "type", ...JitsuInternalProperties]);
      }
      break;
    case "track":
      if (singleTable) {
        transformed = {
          context: {
            traits: {},
          },
        };
        transferFunc(transformed.context, event.context, ["groupId", "traits"]);
        transferFunc(transformed.context.traits, event.context?.traits, ["groupId"]);
        transferFunc(transformed.context.traits, event.properties?.traits, ["groupId"]);
        transferValueFunc(transformed.context, "group_id", event.context?.groupId || event.context?.traits?.groupId);
        transferFunc(transformed, event.properties, ["traits"]);
        transferFunc(transformed, event, ["context", "properties", "type", ...JitsuInternalProperties]);
      } else {
        baseTrackFlat = {};
        transferFunc(baseTrackFlat, event, ["properties", "type", ...JitsuInternalProperties]);
        transformed = {};
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event, ["properties", "type", ...JitsuInternalProperties]);
      }
      break;
    default:
      if (singleTable) {
        transformed = {
          context: {
            traits: {},
          },
        };
        transferFunc(transformed.context, event.context, ["groupId", "traits"]);
        transferFunc(transformed.context.traits, event.context?.traits, ["groupId"]);
        transferValueFunc(transformed.context, "group_id", event.context?.groupId || event.context?.traits?.groupId);
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event, ["context", "properties", ...JitsuInternalProperties]);
      } else {
        transformed = {};
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event, ["properties", ...JitsuInternalProperties]);
      }
  }
  if (event[TableNameParameter]) {
    transformed.type = event.type;
    return { event: transformed, table: event[TableNameParameter] };
  }
  if (singleTable) {
    transformed.type = event.type;
    return { event: transformed, table: "events" };
  } else {
    if (event.type === "track" && event.event) {
      return [
        { event: baseTrackFlat, table: "tracks" },
        { event: transformed, table: event.event },
      ];
    } else {
      return { event: transformed, table: plural(event.type) };
    }
  }
}

export function plural(s: string) {
  switch (s) {
    case "identify":
      return "identifies";
    case "page":
      return "pages";
    case "track":
      return "tracks";
    case "group":
      return "groups";
    default:
      return s;
  }
}

export const dataLayouts: Record<DataLayoutType, DataLayoutImpl<any>> = {
  segment: (event, ctx) => segmentLayout(event, false, ctx),
  "segment-single-table": (event, ctx) => segmentLayout(event, true, ctx),
  "jitsu-legacy": jitsuLegacy,
  passthrough: event => ({ event: omit(event, JitsuInternalProperties), table: event[TableNameParameter] ?? "events" }),
};

export type BulkerDestinationConfig = {
  bulkerEndpoint: string;
  destinationId: string;
  authToken: string;
  dataLayout?: DataLayoutType;
  keepOriginalNames?: boolean;
  streamOptions?: any;
};

const BulkerDestination: JitsuFunction<AnalyticsServerEvent, BulkerDestinationConfig> = async (event, ctx) => {
  const { bulkerEndpoint, destinationId, authToken, dataLayout = "segment-single-table", streamOptions } = ctx.props;
  try {
    const metricsMeta: Omit<MetricsMeta, "messageId"> = {
      workspaceId: ctx.workspace.id,
      streamId: ctx.source.id,
      destinationId: ctx.destination.id,
      connectionId: ctx.connection.id,
      functionId: "builtin.destination.bulker",
    };
    let adjustedEvent = event;
    const clientIds = event.context?.clientIds;
    const ga4 = clientIds?.ga4;
    if (ga4) {
      if (ga4.sessionIds) {
        ga4.sessionIds = JSON.stringify(ga4.sessionIds);
      } else {
        const oldSessions = ga4["sessions"];
        if (oldSessions) {
          ga4.sessionIds = JSON.stringify(oldSessions);
          delete ga4["sessions"];
        }
      }
    }
    const events = dataLayouts[dataLayout](adjustedEvent, ctx);
    for (const { event, table } of Array.isArray(events) ? events : [events]) {
      const payload = JSON.stringify(event);
      if (payload.length > 1000000) {
        throw new Error(
          `Max allowed size is 1 000 000 bytes. Event size is: ${payload.length} bytes: \n${payload.substring(
            0,
            256
          )}...`
        );
      }
      const headers = { Authorization: `Bearer ${authToken}`, metricsMeta: JSON.stringify(metricsMeta) };
      if (streamOptions && Object.keys(streamOptions).length > 0) {
        headers["streamOptions"] = JSON.stringify(streamOptions);
      }
      const res = await request(`${bulkerEndpoint}/post/${destinationId}?tableName=${table}`, {
        method: "POST",
        headers,
        body: payload,
        bodyTimeout: fetchTimeoutMs,
        headersTimeout: fetchTimeoutMs,
        dispatcher: undiciAgent,
      });
      if (res.statusCode != 200) {
        throw new HTTPError(`HTTP Error: ${res.statusCode}`, res.statusCode, await res.body.text());
      } else {
        ctx.log.debug(`HTTP Status: ${res.statusCode} Response: ${await res.body.text()}`);
      }
    }
    return event;
  } catch (e: any) {
    throw new RetryError(e);
  }
};

BulkerDestination.displayName = "Bulker Destination";

BulkerDestination.description =
  "Synthetic destination to send data to Bulker, jitsu sub-system for storing data in databases";

export default BulkerDestination;
