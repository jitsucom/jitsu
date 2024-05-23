import { FullContext, JitsuFunction, UserAgent } from "@jitsu/protocols/functions";
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
export type DataLayoutImpl<T> = (
  event: AnalyticsServerEvent,
  ctx: FullContext<BulkerDestinationConfig>
) => MappedEvent[] | MappedEvent;

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

export function jitsuLegacy(event: AnalyticsServerEvent, ctx: FullContext<BulkerDestinationConfig>): MappedEvent {
  let url: URL | undefined = undefined;
  const analyticsContext = event.context || {};
  const urlStr = analyticsContext.page?.url || event.properties?.url;
  try {
    if (urlStr) {
      url = new URL(urlStr as string);
    }
  } catch (e) {}
  const geo = analyticsContext.geo || {};
  const ua: UserAgent = ctx.ua || ({} as UserAgent);
  const flat = removeUndefined(
    toSnakeCase({
      anon_ip: analyticsContext.ip ? anonymizeIp(analyticsContext.ip) : undefined,
      api_key: event.writeKey || "",
      click_id: {},
      doc_encoding: analyticsContext.page?.encoding || event.properties?.encoding,
      doc_host: url?.hostname,
      doc_path: url?.pathname,
      doc_search: url?.search,
      eventn_ctx_event_id: event.messageId,
      event_type: event.event || event.type,
      local_tz_offset: analyticsContext.page?.timezoneOffset || event.properties?.timezoneOffset,
      page_title: analyticsContext.page?.title,
      referer: analyticsContext.page?.referrer,
      screen_resolution:
        Math.max(analyticsContext.screen?.width || 0) + "x" + Math.max(analyticsContext.screen?.height || 0),
      source_ip: analyticsContext.ip,
      src: "jitsu",
      url: (urlStr || "") as string,
      user: {
        id: event.userId,
        anonymous_id: event.anonymousId,
        email: (analyticsContext.traits?.email || event.traits?.email || undefined) as string | undefined,
        name: (analyticsContext.traits?.name || event.traits?.name || undefined) as string | undefined,
        ...omit(
          {
            ...(analyticsContext.traits || {}),
            ...(event.traits || {}),
          },
          ["email", "name"]
        ),
      },
      location:
        Object.keys(geo).length > 0
          ? {
              city: geo.city?.name,
              continent: geo.continent?.code,
              country: geo.country?.code,
              country_name: geo.country?.name,
              latitude: geo.location?.latitude,
              longitude: geo.location?.longitude,
              region: geo.region?.code,
              zip: geo.postalCode?.code,
              timezone: geo.location?.timezone,
              autonomous_system_number: geo.provider?.as?.num,
              autonomous_system_organization: geo.provider?.as?.name,
              isp: geo.provider?.isp,
              domain: geo.provider?.domain,
            }
          : undefined,
      ids:
        Object.keys(analyticsContext.clientIds || {}).length > 0
          ? {
              ga: analyticsContext.clientIds?.ga4?.clientId,
              fbp: analyticsContext.clientIds?.fbp,
              fbc: analyticsContext.clientIds?.fbc,
            }
          : undefined,
      parsed_ua:
        Object.keys(ua).length > 0
          ? {
              os_family: ua.os?.name,
              os_version: ua.os?.version,
              ua_family: ua.browser?.name,
              ua_version: ua.browser?.version,
              device_brand: ua.device?.vendor,
              device_type: ua.device?.type,
              device_model: ua.device?.model,
              bot: ua.bot,
            }
          : undefined,
      user_agent: analyticsContext.userAgent,
      user_language: analyticsContext.locale,
      utc_time: event.timestamp,
      _timestamp: event.timestamp,
      utm: analyticsContext.campaign,
      vp_size:
        Math.max(analyticsContext.screen?.innerWidth || 0) + "x" + Math.max(analyticsContext.screen?.innerHeight || 0),
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
  "jitsu-legacy": jitsuLegacy,
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
