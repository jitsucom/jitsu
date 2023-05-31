import { JitsuFunction } from "@jitsu/protocols/functions";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { randomId } from "juava";
import { MixpanelCredentials } from "../meta";

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

function trackEvent(
  distinctId: string,
  eventType: string,
  event: AnalyticsServerEvent,
  opts: MixpanelCredentials
): HttpRequest {
  const traits = { ...(event.traits || event.context?.traits || {}) };
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
          ip: event.context?.ip || event.request_ip,
          time: new Date(event.timestamp as string).getTime(),
          distinct_id: distinctId,
          $insert_id: event.messageId + "-" + randomId(),
          $user_id: event.userId ? event.userId : undefined,
          // $browser: "",
          // $browser_version: "",
          $current_url: evict(customProperties, "url"),
          $referrer: evict(customProperties, "referrer"),
          $session_id: event.context?.sessionId,

          $screen_dpi: event.context?.screen?.density,
          $screen_height: event.context?.screen?.height,
          $screen_width: event.context?.screen?.width,
          ...customProperties,
        },
      },
    ],
  };
}
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

function setProfileMessage(distinctId: string, event: AnalyticsServerEvent, opts: MixpanelCredentials): HttpRequest[] {
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
    $ip: event.context?.ip || event.request_ip,
    $set: traits,
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
      $ip: event.context?.ip || event.request_ip,
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

function merge(primaryId: string, secondaryId: string, props: MixpanelCredentials): HttpRequest {
  const basicAuth = getAuth(props);
  return {
    id: randomId(),
    url: `https://api.mixpanel.com/import?strict=1&project_id=${props.projectId}`,
    headers: {
      "Content-type": "application/json",
      Accept: "text-plain",
      Authorization: `Basic ${basicAuth}`,
    },
    payload: [
      {
        event: "$merge",
        properties: {
          $distinct_ids: [primaryId, secondaryId],
        },
      },
    ],
  };
}

const MixpanelDestination: JitsuFunction<AnalyticsServerEvent, MixpanelCredentials> = async (event, ctx) => {
  ctx.log.debug(`Mixpanel destination (props=${JSON.stringify(ctx.props)}) received event ${JSON.stringify(event)}`);
  const messages: HttpRequest[] = [];
  if (event.type === "identify") {
    if (!event.userId) {
      const distinctId = event.anonymousId || event.traits?.email;
      if (!distinctId) {
        ctx.log.info(`No distinct id found for event ${JSON.stringify(event)}`);
      } else if (ctx.props.enableAnonymousUserProfiles) {
        messages.push(...setProfileMessage(distinctId as string, event, ctx.props));
      }
      if (event.anonymousId && event.traits?.email) {
        messages.push(merge(event.anonymousId, event.traits.email as string, ctx.props));
      }
    } else {
      if (event.anonymousId) {
        messages.push(merge(event.userId, event.anonymousId, ctx.props));
      }
      if (event.traits?.email) {
        messages.push(merge(event.userId, event.traits?.email as string, ctx.props));
      }
      messages.push(...setProfileMessage(event.userId, event, ctx.props));
    }
    if (ctx.props.sendIdentifyEvents) {
      const distinctId = event.userId || (event.traits?.email as string) || event.anonymousId;
      if (distinctId) {
        messages.push(trackEvent(distinctId, "Identify", event, ctx.props));
      }
    }
  } else if (event.type === "group" && ctx.props.enableGroupAnalytics) {
    messages.push(setGroupMessage(event, ctx.props));
  } else if (event.type === "track") {
    const distinctId = event.userId || event.anonymousId || (event.traits?.email as string);
    if (!distinctId) {
      ctx.log.info(`No distinct id found for event ${JSON.stringify(event)}`);
    } else {
      if (event.userId || ctx.props.enableAnonymousUserProfiles) {
        messages.push(trackEvent(distinctId, event.event as string, event, ctx.props));
      }
    }
  } else if (event.type === "page") {
    const distinctId = event.userId || event.anonymousId || (event.traits?.email as string);
    if (!distinctId) {
      ctx.log.info(`No distinct id found for Page View event ${JSON.stringify(event)}`);
    } else {
      if (event.userId || ctx.props.enableAnonymousUserProfiles) {
        messages.push(trackEvent(distinctId, "Page View", event, ctx.props));
      }
    }
  }
  for (const message of messages) {
    const method = message.method || "POST";
    try {
      const result = await ctx.fetch(message.url, {
        method,
        headers: message.headers,
        ...(message.payload ? { body: JSON.stringify(message.payload) } : {}),
      });
      const logMessage = `MixPanel ${method} ${message.url}:${
        message.payload ? `${JSON.stringify(message.payload)} --> ` : ""
      }${result.status} ${await result.text()}`;
      if (result.status !== 200) {
        ctx.log.error(logMessage);
      } else {
        ctx.log.debug(logMessage);
      }
    } catch (e: any) {
      throw new Error(
        `Failed to send event to MixPanel: ${method} ${message.url} ${JSON.stringify(message.payload)}: ${e?.message}`
      );
    }
  }
};

MixpanelDestination.displayName = "mixpanel-destination";

MixpanelDestination.description = "This functions covers jitsu events and sends them to MixPanel";

export default MixpanelDestination;
