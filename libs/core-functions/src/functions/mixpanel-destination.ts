import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { randomId } from "juava";
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

export type HttpRequest = {
  id: string;
  method?: string;
  url: string;
  payload?: any;
  headers?: Record<string, string>;
};

function prefix<P extends string = string>(param: Record<any, string>, prefix: P): Record<string, any> {
  return Object.entries(param).reduce((acc, [key, value]) => ({ ...acc, [`${prefix}${key}`]: value }), {});
}

function evict(obj: Record<string, any>, key: string) {
  const val = obj[key];
  delete obj[key];
  return val;
}

function trackEvent(ctx: FullContext, distinctId: string, eventType: string, event: AnalyticsServerEvent): HttpRequest {
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
    ...prefix(event.context?.campaign || {}, "utm_"),
    ...(event.context?.page || {}),
    ...traits,
    ...(event.properties || {}),
    ...(groupId ? { [groupKey]: groupId } : {}),
    userAgent: event.context?.userAgent,
  };
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
          $device_id: `${event.anonymousId}`,
          distinct_id: distinctId,
          $insert_id: event.messageId + "-" + randomId(),
          $user_id: event.userId ? `${event.userId}` : undefined,
          $browser: ctx.ua?.browser?.name,
          $browser_version: ctx.ua?.browser?.version,
          $os: ctx.ua?.os?.name,
          $current_url: evict(customProperties, "url"),
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

  const setPayload: any = {
    $token: opts.projectToken,
    $distinct_id: distinctId,
    $ip: event.context?.ip || event.requestIp,
    $latitude: event.context?.geo?.location?.latitude,
    $longitude: event.context?.geo?.location?.longitude,
    $set: {
      ...traits,
      $initial_referrer: event.context?.page?.referrer,
      $initial_referring_domain: event.context?.page?.referring_domain,
      $browser: ctx.ua?.browser?.name,
      $browser_version: ctx.ua?.browser?.version,
      $os: ctx.ua?.os?.name,
    },
  };

  const reqs = [
    {
      id: randomId(),
      url: "https://api.mixpanel.com/engage?verbose=1#profile-set",
      headers: {
        "Content-type": "application/json",
        Accept: "text-plain",
      },
      payload: [setPayload],
    },
  ];
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

function getDistinctId(ctx: FullContext, event: AnalyticsServerEvent) {
  if (ctx.props.simplifiedIdMerge) {
    return event.userId ? `${event.userId}` : `$device:${event.anonymousId}`;
  } else {
    return `${(event.userId || event.traits?.email || event.context?.traits?.email || event.anonymousId) ?? ""}`;
  }
}

const MixpanelDestination: JitsuFunction<AnalyticsServerEvent, MixpanelCredentials> = async (event, ctx) => {
  ctx.log.debug(`Mixpanel destination (props=${JSON.stringify(ctx.props)}) received event ${JSON.stringify(event)}`);
  const distinctId = getDistinctId(ctx, event);
  if (!distinctId) {
    ctx.log.warn(
      `No distinctId can be assumed in event with messageId: ${event.messageId}. 'anonymousId' is missing. Skipping...`
    );
    return;
  }
  // no userId or email
  const isAnonymous = event.anonymousId && distinctId.endsWith(event.anonymousId);
  if (isAnonymous && !ctx.props.enableAnonymousUserProfiles) {
    return;
  }
  try {
    const messages: HttpRequest[] = [];
    if (event.type === "identify") {
      if (event.userId || !ctx.props.simplifiedIdMerge) {
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
        messages.push(trackEvent(ctx, distinctId, "Identify", event));
      }
    } else {
      if (event.type === "group" && ctx.props.enableGroupAnalytics) {
        messages.push(setGroupMessage(event, ctx.props));
      } else if (event.type === "track") {
        messages.push(trackEvent(ctx, distinctId, event.event as string, event));
      } else if (event.type === "page") {
        messages.push(trackEvent(ctx, distinctId, "Page View", event));
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
