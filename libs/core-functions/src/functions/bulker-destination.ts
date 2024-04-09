import { JitsuFunction } from "@jitsu/protocols/functions";
import { HTTPError, RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent, DataLayoutType } from "@jitsu/protocols/analytics";

import omit from "lodash/omit";
import { MetricsMeta } from "./lib";
import { idToSnakeCaseFast } from "./lib/strings";

const TableNameParameter = "JITSU_TABLE_NAME";
export type MappedEvent = {
  event: any;
  table: string;
};
export type DataLayoutImpl<T> = (event: AnalyticsServerEvent) => MappedEvent[] | MappedEvent;

function anonymizeIp(ip: string | undefined) {
  if (!ip) {
    return;
  }
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
}

function toSnakeCase(param: any): any {
  if (Array.isArray(param)) {
    return param.map(toSnakeCase);
  } else if (typeof param === "object" && param !== null) {
    const r = {};
    for (const [key, value] of Object.entries(param)) {
      r[idToSnakeCaseFast(key)] = toSnakeCase(value);
    }
    return r;
  } else {
    return param;
  }
}

export function removeUndefined(param: any): any {
  if (Array.isArray(param)) {
    return param.map(removeUndefined);
  } else if (typeof param === "object" && param !== null) {
    return Object.fromEntries(
      Object.entries(param)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, removeUndefined(value)])
    );
  } else {
    return param;
  }
}

export function jitsuLegacy(event: AnalyticsServerEvent): MappedEvent {
  let url: URL | undefined = undefined;
  const urlStr = event.context.page?.url || event.properties?.url;
  try {
    if (urlStr) {
      url = new URL(urlStr as string);
    }
  } catch (e) {}

  const flat = removeUndefined(
    toSnakeCase({
      anon_ip: event.context?.ip ? anonymizeIp(event.context?.ip) : undefined,
      api_key: event.writeKey || "",
      click_id: {},
      doc_encoding: event.context?.page?.encoding || event.properties?.encoding,
      doc_host: url?.hostname,
      doc_path: url?.pathname,
      doc_search: url?.search,
      eventn_ctx_event_id: event.messageId,
      event_type: event.event || event.type,
      local_tz_offset: event.context?.page?.timezoneOffset || event.properties?.timezoneOffset,
      page_title: event.context?.page?.title,
      referer: event.context?.page?.referrer,
      screen_resolution: event.context?.page?.screenResolution,
      source_ip: event.context?.ip,
      src: "jitsu",
      url: (urlStr || "") as string,
      user: {
        id: event.userId,
        email: (event.context?.traits?.email || event.traits?.email || undefined) as string | undefined,
        name: (event.context?.traits?.name || event.traits?.name || undefined) as string | undefined,
        ...omit(
          {
            ...(event.context?.traits || {}),
            ...(event.traits || {}),
          },
          ["email", "name"]
        ),
      },
      user_agent: event.context.userAgent,
      user_language: event.context?.locale,
      utc_time: event.timestamp,
      _timestamp: event.timestamp,
      utm: event.context?.campaign,
      vp_size:
        Math.max(event.context?.screen?.innerWidth || 0) + "x" + Math.max(event.context?.screen?.innerHeight || 0),
      ...(event.type === "track" ? event.properties : {}),
    })
  );
  return { event: flat, table: event[TableNameParameter] ?? "events" };
}

export function segmentLayout(event: AnalyticsServerEvent, singleTable: boolean): MappedEvent[] | MappedEvent {
  let transformed: any;
  //track without properties for segment multi-table layout, because full track event is stored in the table with event name
  let baseTrackFlat: any;
  switch (event.type) {
    case "identify":
      if (singleTable) {
        transformed = {
          context: {
            traits: {},
          },
        };
        transferAsSnakeCase(transformed.context, event.context, ["groupId", "traits"]);
        transferAsSnakeCase(transformed.context.traits, event.context?.traits, ["groupId"]);
        transferAsSnakeCase(transformed.context.traits, event.traits, ["groupId"]);
        transferValueAsSnakeCase(
          transformed.context,
          "group_id",
          event.context?.groupId || event.traits?.groupId || event.context?.traits?.groupId
        );
        transferAsSnakeCase(transformed, event.properties);
        transferAsSnakeCase(transformed, event, ["context", "properties", "traits", "type", TableNameParameter]);
      } else {
        transformed = {
          context: {},
        };
        transferAsSnakeCase(transformed.context, event.context, ["traits"]);
        transferAsSnakeCase(transformed, event.properties);
        transferAsSnakeCase(transformed, event.context?.traits);
        transferAsSnakeCase(transformed, event.traits);
        transferAsSnakeCase(transformed, event, ["context", "properties", "traits", "type", TableNameParameter]);
      }
      break;
    case "group":
      if (singleTable) {
        transformed = {
          context: {
            group: {},
          },
        };
        transferAsSnakeCase(transformed.context, event.context);
        transferAsSnakeCase(transformed.context.group, event.traits);
        transferValueAsSnakeCase(transformed.context, "group_id", event.groupId);
        transferAsSnakeCase(transformed, event.properties);
        transferAsSnakeCase(transformed, event, [
          "context",
          "properties",
          "traits",
          "type",
          "groupId",
          TableNameParameter,
        ]);
      } else {
        transformed = {
          context: {},
        };
        transferAsSnakeCase(transformed.context, event.context, ["traits"]);
        transferAsSnakeCase(transformed, event.properties);
        transferAsSnakeCase(transformed, event.traits);
        transferAsSnakeCase(transformed, event, ["context", "properties", "traits", "type", TableNameParameter]);
      }
      break;
    case "track":
      if (singleTable) {
        transformed = {
          context: {
            traits: {},
          },
        };
        transferAsSnakeCase(transformed.context, event.context, ["groupId", "traits"]);
        transferAsSnakeCase(transformed.context.traits, event.context?.traits, ["groupId"]);
        transferAsSnakeCase(transformed.context.traits, event.properties?.traits, ["groupId"]);
        transferValueAsSnakeCase(
          transformed.context,
          "group_id",
          event.context?.groupId || event.context?.traits?.groupId
        );
        transferAsSnakeCase(transformed, event.properties, ["traits"]);
        transferAsSnakeCase(transformed, event, ["context", "properties", "type", TableNameParameter]);
      } else {
        baseTrackFlat = {};
        transferAsSnakeCase(baseTrackFlat, event, ["properties", "type", TableNameParameter]);
        transformed = {};
        transferAsSnakeCase(transformed, event.properties);
        transferAsSnakeCase(transformed, event, ["properties", "type", TableNameParameter]);
      }
      break;
    default:
      if (singleTable) {
        transformed = {
          context: {
            traits: {},
          },
        };
        transferAsSnakeCase(transformed.context, event.context, ["groupId", "traits"]);
        transferAsSnakeCase(transformed.context.traits, event.context?.traits, ["groupId"]);
        transferValueAsSnakeCase(
          transformed.context,
          "group_id",
          event.context?.groupId || event.context?.traits?.groupId
        );
        transferAsSnakeCase(transformed, event.properties);
        transferAsSnakeCase(transformed, event, ["context", "properties", TableNameParameter]);
      } else {
        transformed = {};
        transferAsSnakeCase(transformed, event.properties);
        transferAsSnakeCase(transformed, event, ["properties", TableNameParameter]);
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

function transferAsSnakeCase(target: Record<string, any>, source: any, omit?: string[]) {
  if (typeof source !== "object") {
    return;
  }
  for (const [k, v] of Object.entries(source)) {
    if (!omit || !omit.includes(k)) {
      target[idToSnakeCaseFast(k)] = toSnakeCase(v);
    }
  }
}

function transferValueAsSnakeCase(target: Record<string, any>, property: string, source: any) {
  if (typeof source === "undefined") {
    return;
  }
  target[property] = toSnakeCase(source);
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
  segment: event => segmentLayout(event, false),
  "segment-single-table": event => segmentLayout(event, true),
  "jitsu-legacy": event => jitsuLegacy(event),
  passthrough: event => ({ event: omit(event, TableNameParameter), table: event[TableNameParameter] ?? "events" }),
};

export type BulkerDestinationConfig = {
  bulkerEndpoint: string;
  destinationId: string;
  authToken: string;
  dataLayout?: DataLayoutType;
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
    if (ga4 && (ga4.sessionIds || ga4["sessions"])) {
      adjustedEvent = {
        ...event,
        context: {
          ...event.context,
          clientIds: {
            ...clientIds,
            ga4: {
              clientId: ga4.clientId,
              sessionIds: ga4["sessions"] ? JSON.stringify(ga4["sessions"]) : JSON.stringify(ga4.sessionIds),
            },
          },
        },
      };
    }
    const events = dataLayouts[dataLayout](adjustedEvent);
    for (const { event, table } of Array.isArray(events) ? events : [events]) {
      const res = await ctx.fetch(
        `${bulkerEndpoint}/post/${destinationId}?tableName=${table}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}`, metricsMeta: JSON.stringify(metricsMeta) },
          body: JSON.stringify(event),
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
