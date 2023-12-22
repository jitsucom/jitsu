import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { randomId, hash } from "juava";
import { MixpanelCredentials } from "../meta";
import { eventTimeSafeMs } from "./lib";

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

function utm(param: Record<any, string>, prefix: string = "utm_"): Record<string, any> {
  return Object.entries(param).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [`${prefix}${key === "name" ? "campaign" : key}`]: value,
    }),
    {}
  );
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
  const traits = { ...(event.traits || event.context?.traits || {}) };
  specialProperties.forEach(prop => {
    if (traits[prop]) {
      traits[`$${prop}`] = traits[prop];
      delete traits[prop];
    }
  });
  const groupId = event.context?.groupId || traits.groupId;
  const groupKey = opts.groupKey || "$group_id";
  delete traits.groupId;

  const customProperties = {
    ...utm(event.context?.campaign || {}),
    ...(event.context?.page || {}),
    ...traits,
    ...(event.properties || {}),
    ...(groupId ? { [groupKey]: groupId } : {}),
    userAgent: event.context?.userAgent,
  };
  const pageUrl = evict(customProperties, "url");
  return {
    id: randomId(),
    url: `https://api.mixpanel.com/import?strict=1&project_id=${opts.projectId}`,
    headers: {
      "Content-type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${getAuth(opts)}`,
    },
    payload: [
      {
        event: eventType,
        properties: {
          ip: event.context?.ip || event.requestIp,
          time: eventTimeSafeMs(event),
          $device_id: deviceId,
          distinct_id: distinctId,
          $insert_id: event.messageId + "-" + randomId(),
          $user_id: event.userId ? `${event.userId}` : undefined,
          $browser: ctx.ua?.browser?.name,
          $browser_version: ctx.ua?.browser?.version,
          $os: ctx.ua?.os?.name,
          $current_url: pageUrl,
          ...clickParams(pageUrl),
          current_page_title: evict(customProperties, "title"),
          $referrer: evict(customProperties, "referrer"),
          $referring_domain: evict(customProperties, "referring_domain"),
          $session_id: event.context?.sessionId,
          $latitude: event.context?.geo?.location?.latitude,
          $longitude: event.context?.geo?.location?.longitude,

          $screen_dpi: event.context?.screen?.density,
          $screen_height: event.context?.screen?.height,
          $screen_width: event.context?.screen?.width,
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
          $ip: event.context?.ip || event.requestIp,
          $latitude: event.context?.geo?.location?.latitude,
          $longitude: event.context?.geo?.location?.longitude,
          $set: {
            ...traits,
            $browser: ctx.ua?.browser?.name,
            $browser_version: ctx.ua?.browser?.version,
            $os: ctx.ua?.os?.name,
          },
        },
      ],
    },
  ];
  if (event.context?.page?.referrer || event.context?.page?.referring_domain) {
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
          $ip: event.context?.ip || event.requestIp,
          $latitude: event.context?.geo?.location?.latitude,
          $longitude: event.context?.geo?.location?.longitude,
          $set_once: {
            ...utm(event.context?.campaign || {}, "initial_utm_"),
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
      $ip: event.context?.ip || event.requestIp,
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
  ctx.log.debug(`Mixpanel destination (props=${JSON.stringify(ctx.props)}) received event ${JSON.stringify(event)}`);
  if (typeof ctx.props.filterBotTraffic === "undefined" || ctx.props.filterBotTraffic) {
    if (ctx.ua?.bot) {
      ctx.log.debug(`Skipping bot traffic`);
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
      const result = await ctx.fetch(message.url, {
        method,
        headers: message.headers,
        ...(message.payload ? { body: JSON.stringify(message.payload) } : {}),
      });
      const logMessage = `MixPanel ${method} ${message.url}:${
        message.payload ? `${JSON.stringify(message.payload)} --> ` : ""
      }${result.status} ${await result.text()}`;
      if (result.status !== 200) {
        throw new Error(logMessage);
      } else {
        ctx.log.debug(logMessage);
      }
    }
  } catch (e: any) {
    throw new RetryError(e.message);
  }
};

MixpanelDestination.displayName = "mixpanel-destination";

MixpanelDestination.description = "This functions covers jitsu events and sends them to MixPanel";

export default MixpanelDestination;
