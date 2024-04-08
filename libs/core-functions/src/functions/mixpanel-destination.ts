import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent, Geo } from "@jitsu/protocols/analytics";
import { hash, randomId } from "juava";
import { MixpanelCredentials } from "../meta";
import { eventTimeSafeMs } from "./lib";
import zlib from "zlib";

//See https://help.mixpanel.com/hc/en-us/articles/115004708186-Profile-Properties
export const specialProperties = [
  "avatar",
  "email",
  "phone",
  "name",
  "first_name",
  "last_name",
  "timezone",
  "unsubscribed",
];

const CLICK_IDS = ["dclid", "fbclid", "gclid", "ko_click_id", "li_fat_id", "msclkid", "ttclid", "twclid", "wbraid"];

export type HttpRequest = {
  id: string;
  method?: string;
  url: string;
  payload?: any;
  headers?: Record<string, string>;
};

// Map and extracts campaign parameters from context.campaign into object with utm properties
function utmFromCampaign(param: Record<string, any>, prefix: string = ""): Record<string, any> {
  return Object.entries(param).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [`${prefix}utm_${key === "name" ? "campaign" : key}`]: value,
    }),
    {}
  );
}

// Extracts utm parameters from properties and returns them as a new object
function extractUtmParams(properties: Record<string, any>, prefix: string = ""): Record<string, any> {
  return Object.entries(properties).reduce((acc, [key, value]) => {
    if (key.startsWith("utm_")) {
      acc[`${prefix}${key}`] = value;
    }
    return acc;
  }, {});
}

function evict(obj: Record<string, any>, key: string) {
  const val = obj[key];
  delete obj[key];
  return val;
}

function getQueryParam(url: string, param: string) {
  param = param.replace(/[[]/, "\\[").replace(/[\]]/, "\\]");
  const regexS = "[\\?&]" + param + "=([^&#]*)",
    regex = new RegExp(regexS),
    results = regex.exec(url);
  if (results === null || (results && typeof results[1] !== "string" && results[1]["length"])) {
    return "";
  } else {
    let result = results[1];
    try {
      result = decodeURIComponent(result);
    } catch (err) {}
    return result.replace(/\+/g, " ");
  }
}

function geoParams(geo?: Geo) {
  if (!geo) {
    return {};
  }
  const params: any = {};
  if (geo.country?.code) {
    params.mp_country_code = geo.country.code;
  }
  if (geo.region?.code) {
    params.$region = geo.region.code;
  }
  if (geo.city?.name) {
    params.$city = geo.city.name;
  }
  if (geo.location?.latitude && geo.location?.longitude) {
    params.$geo_source = "reverse_geocoding";
    params.$latitude = geo.location.latitude;
    params.$longitude = geo.location.longitude;
  }
  return params;
}

function clickParams(url: string) {
  if (!url) {
    return {};
  }
  const params: any = {};
  CLICK_IDS.forEach(idkey => {
    const id = getQueryParam(url, idkey);
    if (id.length) {
      params[idkey] = id;
    }
  });

  return params;
}

function trackEvent(
  ctx: FullContext,
  deviceId: string,
  distinctId: string,
  eventType: string,
  event: AnalyticsServerEvent
): HttpRequest {
  const opts = ctx.props as MixpanelCredentials;
  const analyticsContext = event.context || {};
  const traits = { ...(event.traits || analyticsContext.traits || {}) };
  specialProperties.forEach(prop => {
    if (traits[prop]) {
      traits[`$${prop}`] = traits[prop];
      delete traits[prop];
    }
  });
  const groupId = analyticsContext.groupId || traits.groupId;
  const groupKey = opts.groupKey || "$group_id";
  delete traits.groupId;

  const customProperties = {
    ...utmFromCampaign(analyticsContext.campaign || {}),
    ...(analyticsContext.page || {}),
    ...traits,
    ...(event.properties || {}),
    ...(groupId ? { [groupKey]: groupId } : {}),
    userAgent: analyticsContext.userAgent,
  };
  const pageUrl = evict(customProperties, "url");
  return {
    id: randomId(),
    url: `https://api.mixpanel.com/import?strict=1&project_id=${opts.projectId}`,
    headers: {
      "Content-type": "application/json",
      "Content-Encoding": "gzip",
      Accept: "application/json",
      Authorization: `Basic ${getAuth(opts)}`,
    },
    payload: [
      {
        event: eventType,
        properties: {
          ip: analyticsContext.ip,
          time: eventTimeSafeMs(event),
          $device_id: deviceId,
          distinct_id: distinctId,
          $insert_id: hash("md5", event.messageId) + "-" + randomId(),
          $user_id: event.userId ? `${event.userId}` : undefined,
          $browser: ctx.ua?.browser?.name,
          $browser_version: ctx.ua?.browser?.version,
          $os: analyticsContext.os?.name || ctx.ua?.os?.name,
          $os_version: analyticsContext.os?.version || ctx.ua?.os?.version,
          $current_url: pageUrl,
          ...clickParams(pageUrl),
          current_page_title: evict(customProperties, "title"),
          $referrer: evict(customProperties, "referrer"),
          $referring_domain: evict(customProperties, "referring_domain"),
          $session_id: analyticsContext.sessionId,

          ...geoParams(analyticsContext.geo),

          //mobile
          $app_namespace: analyticsContext.app?.namespace,
          $app_name: analyticsContext.app?.name,
          $app_build_number: analyticsContext.app?.build,
          $app_release: analyticsContext.app?.build,
          $app_version: analyticsContext.app?.version,
          $app_version_string: analyticsContext.app?.version,

          $carrier: analyticsContext?.network?.carrier,
          $has_telephone: analyticsContext?.network?.cellular,
          $bluetooth_enabled: analyticsContext.network?.bluetooth,
          $wifi: analyticsContext?.network?.wifi,

          $screen_dpi: analyticsContext.screen?.density,
          $screen_height: analyticsContext.screen?.height,
          $screen_width: analyticsContext.screen?.width,

          // $bluetooth_version: "ble",
          // $brand: "google",
          // $had_persisted_distinct_id: false,
          // $has_nfc: false,
          $device_type: analyticsContext.device?.type || ctx.ua?.device?.type,
          $device_name: analyticsContext.device?.name || ctx.ua?.device?.model,
          $manufacturer: analyticsContext.device?.manufacturer || ctx.ua?.device?.vendor,
          $model: analyticsContext.device?.model || ctx.ua?.device?.model,
          advertising_id: analyticsContext.device?.advertisingId,
          ad_tracking_enabled: analyticsContext.device?.adTrackingEnabled,

          ...customProperties,
        },
      },
    ],
  };
}

function setProfileMessage(ctx: FullContext, distinctId: string, event: AnalyticsServerEvent): HttpRequest[] {
  const opts = ctx.props as MixpanelCredentials;
  const traits = { ...(event.traits || event.context?.traits || {}) };
  specialProperties.forEach(prop => {
    if (traits[prop]) {
      traits[`$${prop}`] = traits[prop];
      delete traits[prop];
    }
  });
  const groupId = event.context?.groupId || traits.groupId;
  delete traits.groupId;

  let mobileDeviceInfo: any = {};
  if (event.context?.os?.name === "Android" && event.context?.app) {
    mobileDeviceInfo = {
      $android_app_version: event.context.app.version,
      $android_app_version_code: event.context.app.build,
      $android_manufacturer: event.context.device?.manufacturer,
      $android_model: event.context.device?.model,
      $android_os: event.context.os?.name,
      $android_os_version: event.context.os?.version,
    };
  } else if (event.context?.device?.manufacturer === "Apple" && event.context?.app) {
    mobileDeviceInfo = {
      $ios_app_version: event.context.app.build,
      $ios_app_release: event.context.app.version,
      $ios_device_model: event.context.device?.model,
      $ios_version: event.context.os?.version,
    };
  }

  const reqs: HttpRequest[] = [
    {
      id: randomId(),
      url: "https://api.mixpanel.com/engage?verbose=1#profile-set",
      headers: {
        "Content-type": "application/json",
        Accept: "text-plain",
      },
      payload: [
        {
          $token: opts.projectToken,
          $distinct_id: distinctId,
          $ip: event.context?.ip,
          $set: {
            ...geoParams(event.context?.geo),
            ...traits,
            $browser: ctx.ua?.browser?.name,
            $browser_version: ctx.ua?.browser?.version,
            $os: ctx.ua?.os?.name,
            ...mobileDeviceInfo,
          },
        },
      ],
    },
  ];
  if (event.context?.page?.referrer || event.context?.page?.referring_domain) {
    const utm = {
      ...utmFromCampaign(event.context?.campaign || {}, "initial_"),
      ...extractUtmParams(event.properties || {}, "initial_"),
    };
    reqs.push({
      id: randomId(),
      url: "https://api.mixpanel.com/engage?verbose=1#profile-set-once",
      headers: {
        "Content-type": "application/json",
        Accept: "text-plain",
      },
      payload: [
        {
          $token: opts.projectToken,
          $distinct_id: distinctId,
          $ip: event.context?.ip,
          $set_once: {
            ...utm,
            $initial_referrer: event.context?.page?.referrer,
            $initial_referring_domain: event.context?.page?.referring_domain,
          },
        },
      ],
    });
  }
  if (groupId) {
    const groupKey = opts.groupKey || "$group_id";
    const unionPayload: any = {
      $token: opts.projectToken,
      $distinct_id: distinctId,
      $ip: event.context?.ip,
      $union: { [groupKey]: [groupId] },
    };
    reqs.push({
      id: randomId(),
      url: "https://api.mixpanel.com/engage?verbose=1#profile-union",
      headers: {
        "Content-type": "application/json",
        Accept: "text-plain",
      },
      payload: [unionPayload],
    });
  }
  return reqs;
}

function setGroupMessage(event: AnalyticsServerEvent, opts: MixpanelCredentials): HttpRequest {
  const props = { ...(event.traits || {}) };
  specialProperties.forEach(prop => {
    if (props[prop]) {
      props[`$${prop}`] = props[prop];
      delete props[prop];
    }
  });
  const groupKey = opts.groupKey || "$group_id";
  const setPayload = {
    $token: opts.projectToken,
    $group_key: groupKey,
    $group_id: event.groupId,
    $set: props,
  };

  return {
    id: randomId(),
    url: "https://api.mixpanel.com/groups?verbose=1#group-set",
    headers: {
      "Content-type": "application/json",
      Accept: "text-plain",
    },
    payload: [setPayload],
  };
}

function base64(str: string) {
  return btoa(str);
}

function getAuth(props: MixpanelCredentials) {
  return base64(`${props.serviceAccountUserName}:${props.serviceAccountPassword}`);
}

function merge(ctx: FullContext, messageId: string, identifiedId: string, anonymousId: string): HttpRequest[] {
  if (!anonymousId) {
    return [];
  }
  const opts = ctx.props as MixpanelCredentials;
  const basicAuth = getAuth(opts);
  return [
    {
      id: randomId(),
      url: `https://api.mixpanel.com/import?strict=1&project_id=${opts.projectId}`,
      headers: {
        "Content-type": "application/json",
        Accept: "text-plain",
        Authorization: `Basic ${basicAuth}`,
      },
      payload: [
        {
          event: "$merge",
          properties: {
            $insert_id: messageId + "-" + randomId(),
            $distinct_ids: [identifiedId, anonymousId],
            token: opts.projectToken,
          },
        },
      ],
    },
  ];
}

function alias(ctx: FullContext, messageId: string, identifiedId: string, anonymousId: string): HttpRequest[] {
  if (!anonymousId) {
    return [];
  }
  const opts = ctx.props as MixpanelCredentials;
  const basicAuth = getAuth(opts);
  return [
    {
      id: randomId(),
      url: `https://api.mixpanel.com/import?strict=1&project_id=${opts.projectId}`,
      headers: {
        "Content-type": "application/json",
        Accept: "text-plain",
        Authorization: `Basic ${basicAuth}`,
      },
      payload: [
        {
          event: "$create_alias",
          properties: {
            $insert_id: messageId + "-" + randomId(),
            distinct_id: anonymousId,
            alias: identifiedId,
            token: opts.projectToken,
          },
        },
      ],
    },
  ];
}

function getDistinctId(ctx: FullContext, event: AnalyticsServerEvent, deviceId: string) {
  if (ctx.props.simplifiedIdMerge) {
    return event.userId ? `${event.userId}` : `$device:${deviceId}`;
  } else {
    return `${(event.userId || event.traits?.email || event.context?.traits?.email || deviceId) ?? ""}`;
  }
}

function getDeviceId(ctx: FullContext, event: AnalyticsServerEvent) {
  let deviceId = event.anonymousId;
  if (
    !deviceId ||
    deviceId === "undefined" ||
    deviceId === "unknown" ||
    deviceId === "00000000-0000-0000-0000-000000000000"
  ) {
    const traits = event.traits || event.context?.traits;
    const id = `${event.userId ?? ""}${event.context.ip ? `${event.context.ip}${event.context.userAgent ?? ""}` : ""}${
      traits ? JSON.stringify(traits) : ""
    }`;
    if (id) {
      deviceId = hash("sha256", id);
    }
  } else {
    if (typeof deviceId === "number") {
      return `${deviceId}`;
    }
    if (typeof deviceId !== "string") {
      deviceId = `${JSON.stringify(deviceId)}`;
    }
    if (deviceId.length > 250) {
      deviceId = hash("sha256", deviceId);
    }
  }
  return deviceId;
}

const MixpanelDestination: JitsuFunction<AnalyticsServerEvent, MixpanelCredentials> = async (event, ctx) => {
  if (typeof ctx.props.filterBotTraffic === "undefined" || ctx.props.filterBotTraffic) {
    if (ctx.ua?.bot) {
      return;
    }
  }
  const trackPageView = typeof ctx.props.sendPageEvents === "undefined" || ctx.props.sendPageEvents;
  const deviceId = getDeviceId(ctx, event);
  if (!deviceId) {
    ctx.log.warn(
      `No anonymousId and there is no way to assume anonymous id from event: at least context.ip or any user trait is required. Skipping.`
    );
    return;
  }
  const distinctId = getDistinctId(ctx, event, deviceId);
  // no userId or email
  const isAnonymous = event.anonymousId && distinctId.endsWith(event.anonymousId);
  if (isAnonymous && !ctx.props.enableAnonymousUserProfiles) {
    return;
  }
  try {
    const messages: HttpRequest[] = [];
    if (event.type === "identify") {
      if (event.userId) {
        messages.push(...setProfileMessage(ctx, distinctId, event));
      }
      if (!ctx.props.simplifiedIdMerge && !isAnonymous) {
        if (event.userId) {
          messages.push(...merge(ctx, event.messageId, distinctId, `${event.anonymousId}`));
        } else {
          // when no userId, distinctId=email for non-anonymous events. make an alias
          messages.push(...alias(ctx, event.messageId, distinctId, `${event.anonymousId}`));
        }
      }
      if (ctx.props.sendIdentifyEvents) {
        messages.push(trackEvent(ctx, deviceId, distinctId, "Identify", event));
      }
    } else {
      if (event.type === "group" && ctx.props.enableGroupAnalytics) {
        messages.push(setGroupMessage(event, ctx.props));
      } else if (event.type === "track") {
        messages.push(trackEvent(ctx, deviceId, distinctId, event.event as string, event));
      } else if (event.type === "page" && trackPageView) {
        messages.push(trackEvent(ctx, deviceId, distinctId, "$mp_web_page_view", event));
      } else if (event.type === "screen") {
        messages.push(trackEvent(ctx, deviceId, distinctId, "Screen", event));
      }
    }
    for (const message of messages) {
      const method = message.method || "POST";
      const payload = message.payload ? JSON.stringify(message.payload) : "{}";
      const compressed = message.headers?.["Content-Encoding"] === "gzip" ? zlib.gzipSync(payload) : payload;
      const result = await ctx.fetch(message.url, {
        method,
        headers: message.headers,
        ...(message.payload ? { body: compressed } : {}),
      });
      if (result.status !== 200) {
        throw new Error(
          `MixPanel ${method} ${message.url}:${
            message.payload
              ? `${JSON.stringify(message.payload)} (size: ${payload.length} compressed: ${compressed.length}) --> `
              : ""
          }${result.status} ${await result.text()}`
        );
      } else {
        ctx.log.debug(`MixPanel ${method} ${message.url}: ${result.status} ${await result.text()}`);
      }
    }
  } catch (e: any) {
    throw new RetryError(e.message);
  }
};

MixpanelDestination.displayName = "mixpanel-destination";

MixpanelDestination.description = "This functions covers jitsu events and sends them to MixPanel";

export default MixpanelDestination;
