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

import omit from "lodash/omit";
import { MetricsMeta } from "./lib";

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
  return { event: flat, table: event[TableNameParameter] ?? "events" };
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
        transferFunc(transformed, event, ["context", "properties", "traits", "type", TableNameParameter]);
      } else {
        transformed = {
          context: {},
        };
        transferFunc(transformed.context, event.context, ["traits"]);
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event.context?.traits);
        transferFunc(transformed, event.traits);
        transferFunc(transformed, event, ["context", "properties", "traits", "type", TableNameParameter]);
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
        transferFunc(transformed, event, ["context", "properties", "traits", "type", "groupId", TableNameParameter]);
      } else {
        transformed = {
          context: {},
        };
        transferFunc(transformed.context, event.context, ["traits"]);
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event.traits);
        transferFunc(transformed, event, ["context", "properties", "traits", "type", TableNameParameter]);
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
        transferFunc(transformed, event, ["context", "properties", "type", TableNameParameter]);
      } else {
        baseTrackFlat = {};
        transferFunc(baseTrackFlat, event, ["properties", "type", TableNameParameter]);
        transformed = {};
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event, ["properties", "type", TableNameParameter]);
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
        transferFunc(transformed, event, ["context", "properties", TableNameParameter]);
      } else {
        transformed = {};
        transferFunc(transformed, event.properties);
        transferFunc(transformed, event, ["properties", TableNameParameter]);
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
  passthrough: event => ({ event: omit(event, TableNameParameter), table: event[TableNameParameter] ?? "events" }),
};

export type BulkerDestinationConfig = {
  bulkerEndpoint: string;
  destinationId: string;
  authToken: string;
  dataLayout?: DataLayoutType;
  keepOriginalNames?: boolean;
};

const BulkerDestination: JitsuFunction<AnalyticsServerEvent, BulkerDestinationConfig> = async (event, ctx) => {
  const { bulkerEndpoint, destinationId, authToken, dataLayout = "segment-single-table" } = ctx.props;
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
      const res = await ctx.fetch(
        `${bulkerEndpoint}/post/${destinationId}?tableName=${table}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}`, metricsMeta: JSON.stringify(metricsMeta) },
          body: payload,
        },
        { log: false }
      );
      if (!res.ok) {
        throw new HTTPError(`HTTP Error: ${res.status} ${res.statusText}`, res.status, await res.text());
      } else {
        ctx.log.debug(`HTTP Status: ${res.status} ${res.statusText} Response: ${await res.text()}`);
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
