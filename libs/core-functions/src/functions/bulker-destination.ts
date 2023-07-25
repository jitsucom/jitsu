import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent, DataLayoutType } from "@jitsu/protocols/analytics";
import type { Event as JitsuLegacyEvent } from "@jitsu/sdk-js";

import omit from "lodash/omit";

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

function idToSnakeCase(id: string) {
  return id.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function toSnakeCase(param: any): any {
  if (Array.isArray(param)) {
    return param.map(toSnakeCase);
  } else if (typeof param === "object" && param !== null) {
    return Object.fromEntries(Object.entries(param).map(([key, value]) => [idToSnakeCase(key), toSnakeCase(value)]));
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
      transformed = {
        ...(event.context ? { context: omit(event.context, "traits") } : {}),
        ...event.properties,
        ...event.context?.traits,
        ...event.traits,
        ...omit(event, ["context", "properties", "traits", "type", TableNameParameter]),
      };
      break;
    case "group":
      transformed = {
        ...(event.context ? { context: omit(event.context, "traits") } : {}),
        ...event.properties,
        ...event.traits,
        ...omit(event, ["context", "properties", "traits", "type", TableNameParameter]),
      };
      break;
    case "track":
      if (!singleTable) {
        baseTrackFlat = toSnakeCase({
          ...omit(event, ["properties", "type", TableNameParameter]),
        });
      }
      transformed = {
        ...(event.properties || {}),
        ...omit(event, ["properties", "type", TableNameParameter]),
      };
      break;
    default:
      transformed = {
        ...(event.properties || {}),
        ...omit(event, ["properties", TableNameParameter]),
      };
  }
  const flat: Record<string, any> = toSnakeCase(transformed);
  if (event[TableNameParameter]) {
    flat.type = event.type;
    return { event: flat, table: event[TableNameParameter] };
  }
  if (singleTable) {
    flat.type = event.type;
    return { event: flat, table: "events" };
  } else {
    if (event.type === "track" && event.event) {
      return [
        { event: baseTrackFlat, table: "tracks" },
        { event: flat, table: event.event },
      ];
    } else {
      return { event: flat, table: plural(event.type) };
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
  segment: event => segmentLayout(event, false),
  "segment-single-table": event => segmentLayout(event, true),
  "jitsu-legacy": event => jitsuLegacy(event),
};

export type BulkerDestinationConfig = {
  bulkerEndpoint: string;
  destinationId: string;
  authToken: string;
  dataLayout?: DataLayoutType;
};

const BulkerDestination: JitsuFunction<AnalyticsServerEvent, BulkerDestinationConfig> = async (event, ctx) => {
  const { bulkerEndpoint, destinationId, authToken, dataLayout = "segment-single-table" } = ctx.props;
  const events = dataLayouts[dataLayout](event);

  for (const { event, table } of Array.isArray(events) ? events : [events]) {
    await ctx.fetch(
      `${bulkerEndpoint}/post/${destinationId}?tableName=${table}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(event),
      },
      false
    );
  }
  return event;
};

BulkerDestination.displayName = "Bulker Destination";

BulkerDestination.description =
  "Synthetic destination to send data to Bulker, jitsu sub-system for storing data in databases";

export default BulkerDestination;
