import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent, DataLayoutType } from "@jitsu/protocols/analytics";
import type { Event as JitsuLegacyEvent } from "@jitsu/sdk-js";

import { omit } from "lodash";

const TableNameParameter = "JITSU_TABLE_NAME";
export type DataLayoutImpl<T> = (event: AnalyticsServerEvent) => [T, string[] | string];

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

export function jitsuLegacy(event: AnalyticsServerEvent): [JitsuLegacyEvent, string] {
  let url: URL | undefined = undefined;
  const urlStr = event.context.page?.url || event.properties?.url;
  try {
    if (urlStr) {
      url = new URL(urlStr as string);
    }
  } catch (e) {}

  return removeUndefined(
    toSnakeCase({
      anon_ip: event.context?.ip ? anonymizeIp(event.context?.ip) : undefined,
      api_key: event.writeKey || "",
      click_id: {},
      doc_encoding: event.context?.page?.encoding || event.properties?.encoding,
      doc_host: url?.hostname,
      doc_path: url?.pathname,
      doc_search: url?.search,
      event_id: event.messageId,
      event_type: event.type,
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
      vp_size: "",
    })
  );
}

export function segmentLayout(
  event: AnalyticsServerEvent,
  singleTable: boolean
): [Record<string, any>, string[] | string] {
  const flat: Record<string, any> = toSnakeCase(
    event.type === "identify"
      ? {
          ...{
            context: event?.context ? { ...omit(event.context, "traits") } : undefined,
            ...omit(event, ["context", "properties", TableNameParameter]),
          },
          ...(event.properties || {}),
          ...(event.context?.traits || {}),
          ...(event.traits || {}),
        }
      : {
          ...omit(event, ["properties", TableNameParameter]),
          ...(event.properties || {}),
        }
  );
  if (event[TableNameParameter]) {
    return [flat, event[TableNameParameter]];
  }
  if (singleTable) {
    return [flat, "events"];
  } else if (event.type === "track" && event.event) {
    return [flat, ["tracks", event.event]];
  } else {
    return [flat, plural(event.type)];
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
  "jitsu-legacy": event => [jitsuLegacy(event), event[TableNameParameter] ?? "events"],
};

export type BulkerDestinationConfig = {
  bulkerEndpoint: string;
  destinationId: string;
  authToken: string;
  dataLayout?: DataLayoutType;
};

const BulkerDestination: JitsuFunction<AnalyticsServerEvent, BulkerDestinationConfig> = async (event, ctx) => {
  const { bulkerEndpoint, destinationId, authToken, dataLayout = "segment-single-table" } = ctx.props;
  const [data, tables] = dataLayouts[dataLayout](event);

  for (const table of Array.isArray(tables) ? tables : [tables]) {
    await ctx.fetch(
      `${bulkerEndpoint}/post/${destinationId}?tableName=${table}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(data),
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
