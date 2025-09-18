import { AnyEvent, FullContext, UserAgent } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { removeUndefined, transferAsSnakeCase, transfer, transferAsClassic } from "./objects";

export const TableNameParameter = "JITSU_TABLE_NAME";

export const DropRetryErrorName = "Drop & RetryError";
export const RetryErrorName = "RetryError";

export class RetryError extends Error {
  status: number;
  response: string;
  message: string;
  constructor(message?: any, options?: { drop: boolean }) {
    if (typeof message === "object") {
      super(message.message);
      this.message = message.message;
      this.status = message.status;
      this.response = message.response;
    } else {
      super(message);
      this.message = message;
    }
    this.name = options?.drop ? `${DropRetryErrorName}` : `${RetryErrorName}`;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      response: this.response,
    };
  }
}

export class HTTPError extends Error {
  status: number;
  response: string;
  message: string;
  constructor(message: string, status: number, response: string) {
    super(message);
    this.message = message;
    this.name = "HTTPError";
    this.status = status;
    this.response = response.length > 1000 ? response.slice(0, 1000) + "..." : response;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      response: this.response,
    };
  }
}

function anonymizeIp(ip: string | undefined) {
  if (!ip) {
    return;
  }
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
}

export function toJitsuClassic(event: AnalyticsServerEvent, ctx: FullContext): AnyEvent {
  const keepOriginalNames = !!ctx.props.keepOriginalNames;
  const fileStorage = ctx.destination.type === "s3" || ctx.destination.type === "gcs";
  let transferFunc = transferAsSnakeCase;
  if (keepOriginalNames) {
    if (fileStorage) {
      transferFunc = transfer;
    } else {
      transferFunc = transferAsClassic;
    }
  }
  let url: URL | undefined = undefined;
  const analyticsContext = event.context || {};
  const urlStr = analyticsContext.page?.url || event.properties?.url;
  try {
    if (urlStr) {
      url = new URL(urlStr as string);
    }
  } catch (e) {}
  const click_id = {};
  transferFunc(click_id, analyticsContext.clientIds, ["ga4", "fbp", "fbc"]);
  let ids: any = {};
  if (Object.keys(analyticsContext.clientIds || {}).length > 0) {
    ids = removeUndefined({
      ga: analyticsContext.clientIds.ga4?.clientId,
      fbp: analyticsContext.clientIds.fbp,
      fbc: analyticsContext.clientIds.fbc,
    });
  }
  const geo = analyticsContext.geo || {};
  const ua: UserAgent = ctx?.ua || ({} as UserAgent);
  const user = removeUndefined({
    id: event.userId,
    anonymous_id: event.anonymousId,
    email: (analyticsContext.traits?.email || event.traits?.email || undefined) as string | undefined,
    name: (analyticsContext.traits?.name || event.traits?.name || undefined) as string | undefined,
  });
  transferFunc(user, analyticsContext.traits, ["email", "name"]);
  transferFunc(user, event.traits, ["email", "name"]);
  const classic = {
    [TableNameParameter]: event[TableNameParameter],
    anon_ip: analyticsContext.ip ? anonymizeIp(analyticsContext.ip) : undefined,
    api_key: event.writeKey || "",
    click_id: Object.keys(click_id).length > 0 ? click_id : undefined,
    doc_encoding: analyticsContext.page?.encoding ?? event.properties?.encoding,
    doc_host: (analyticsContext.page?.host ?? event.properties?.host) || url?.host,
    doc_path: (analyticsContext.page?.path ?? event.properties?.path) || url?.pathname,
    doc_search: (analyticsContext.page?.search ?? event.properties?.search) || url?.search,
    eventn_ctx_event_id: event.messageId,
    event_type: event.event || event.type,
    local_tz_offset: analyticsContext.page?.timezoneOffset ?? event.properties?.timezoneOffset,
    page_title: analyticsContext.page?.title,
    referer: analyticsContext.page?.referrer,
    screen_resolution:
      Object.keys(analyticsContext.screen || {}).length > 0
        ? Math.max(analyticsContext.screen.width || 0) + "x" + Math.max(analyticsContext.screen.height || 0)
        : undefined,
    source_ip: analyticsContext.ip,
    src: event.properties?.src || "jitsu",
    url: urlStr as string,
    user: Object.keys(user).length > 0 ? user : undefined,
    location:
      Object.keys(geo).length > 0
        ? {
            city: geo.city?.name,
            continent: geo.continent?.name,
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
    ids: Object.keys(ids).length > 0 ? ids : undefined,
    parsed_ua:
      event.parsed_ua ||
      (Object.keys(ua).length > 0
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
        : undefined),
    user_agent: analyticsContext.userAgent,
    user_language: analyticsContext.locale,
    utc_time: event.timestamp,
    _timestamp: event.receivedAt,
    utm: analyticsContext.campaign,
    vp_size:
      Object.keys(analyticsContext.screen || {}).length > 0
        ? Math.max(analyticsContext.screen.innerWidth || 0) + "x" + Math.max(analyticsContext.screen.innerHeight || 0)
        : undefined,
  };
  if (event.type === "track") {
    transferFunc(classic, event.properties);
  } else {
    transferFunc(classic, event.properties, ["url", "title", "referrer", "search", "host", "path", "width", "height"]);
  }

  return removeUndefined(classic);
}

export function fromJitsuClassic(event: AnyEvent): AnyEvent {
  let type = "track";
  let eventName: string | undefined = undefined;
  switch ((event.event_type ?? "").toLowerCase()) {
    case "pageview":
    case "page_view":
    case "page":
      type = "page";
      eventName = event.event_type;
      break;
    case "identify":
      type = "identify";
      break;
    case "screen":
      type = "screen";
      break;
    case "group":
      type = "group";
      break;
    case "alias":
      type = "alias";
      break;
    default:
      type = "track";
      eventName = event.event_type;
      break;
  }
  const clientIds =
    Object.keys(event.ids || event.click_id || {}).length > 0
      ? {
          ga4: event.ids?.ga
            ? {
                clientId: event.ids.ga,
              }
            : undefined,
          fbp: event.ids?.fbp,
          fbc: event.ids?.fbc,
          ...event.click_id,
        }
      : undefined;
  const loc = event.location || {};
  const geo =
    Object.keys(loc).length > 0
      ? {
          city: {
            name: loc.city,
          },
          continent: {
            code: loc.continent,
          },
          country: {
            code: loc.country,
            name: loc.country_name,
          },
          location: {
            latitude: loc.latitude,
            longitude: loc.longitude,
            timezone: loc.timezone,
          },
          region: {
            code: loc.region,
          },
          postalCode: {
            code: loc.zip,
          },
          provider: {
            as: {
              num: loc.autonomous_system_number,
              name: loc.autonomous_system_organization,
            },
            isp: loc.isp,
            domain: loc.domain,
          },
        }
      : undefined;
  const traits = {};
  transfer(traits, event.user, ["id", "anonymous_id"]);
  const properties: any = {};
  transfer(properties, event, [
    TableNameParameter,
    "anon_ip",
    "api_key",
    "click_id",
    "doc_encoding",
    "doc_host",
    "doc_path",
    "doc_search",
    "eventn_ctx_event_id",
    "event_type",
    "local_tz_offset",
    "page_title",
    "referer",
    "screen_resolution",
    "source_ip",
    "url",
    "user",
    "location",
    "parsed_ua",
    "user_agent",
    "user_language",
    "utc_time",
    "_timestamp",
    "utm",
    "vp_size",
  ]);
  if (type === "page") {
    properties.url = event.url;
    properties.title = event.page_title;
    properties.referrer = event.referer;
    properties.search = event.doc_search;
    properties.host = event.doc_host;
    properties.path = event.doc_path;
    properties.width = parseInt(event.vp_size?.split("x")[0]);
    properties.height = parseInt(event.vp_size?.split("x")[1]);
  }
  const screen: any = {};
  const sr = event.screen_resolution?.split("x");
  if (sr?.length === 2) {
    screen.width = parseInt(sr[0]);
    screen.height = parseInt(sr[1]);
  }
  const vs = event.vp_size?.split("x");
  if (vs?.length === 2) {
    screen.innerWidth = parseInt(vs[0]);
    screen.innerHeight = parseInt(vs[1]);
  }

  return removeUndefined({
    [TableNameParameter]: event[TableNameParameter],
    messageId: event.eventn_ctx_event_id,
    userId: event.user?.id,
    anonymousId: event.user?.anonymous_id,
    timestamp: event.utc_time,
    receivedAt: event._timestamp,
    writeKey: event.api_key,
    type,
    event: eventName,
    context: {
      ip: event.source_ip,
      locale: event.user_language,
      userAgent: event.user_agent,
      page: {
        url: event.url,
        title: event.page_title,
        referrer: event.referer,
        search: event.doc_search,
        host: event.doc_host,
        path: event.doc_path,
        encoding: event.doc_encoding,
        timezoneOffset: event.local_tz_offset,
      },
      screen: Object.keys(screen).length > 0 ? screen : undefined,
      clientIds,
      campaign: event.utm,
      traits,
      geo,
    },
    properties,
    traits: type === "identify" || type === "group" ? traits : undefined,
  });
}
