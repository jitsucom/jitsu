import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { BrazeCredentials } from "../meta";
import { eventTimeSafeMs } from "./lib";
import omit from "lodash/omit";
import { pick } from "lodash";

const endpoints = {
  "US-01 : dashboard-01.braze.com": "https://rest.iad-01.braze.com",
  "US-02 : dashboard-02.braze.com": "https://rest.iad-02.braze.com",
  "US-03 : dashboard-03.braze.com": "https://rest.iad-03.braze.com",
  "US-04 : dashboard-04.braze.com": "https://rest.iad-04.braze.com",
  "US-05 : dashboard-05.braze.com": "https://rest.iad-05.braze.com",
  "US-06 : dashboard-06.braze.com": "https://rest.iad-06.braze.com",
  "US-07 : dashboard-07.braze.com": "https://rest.iad-07.braze.com",
  "US-08 : dashboard-08.braze.com": "https://rest.iad-08.braze.com",
  "US-09 : dashboard-09.braze.com": "https://rest.iad-09.braze.com",
  "EU-01 : dashboard-01.braze.eu": "https://rest.fra-01.braze.eu",
  "EU-02 : dashboard-02.braze.eu": "https://rest.fra-02.braze.eu",
};
export type HttpRequest = {
  method?: string;
  url: string;
  payload?: any;
  headers?: Record<string, string>;
};

function toBrazeGender(gender: string | null | undefined): string | null | undefined {
  if (!gender) {
    return gender;
  }

  const genders: Record<string, string[]> = {
    M: ["man", "male", "m"],
    F: ["woman", "female", "w", "f"],
    O: ["other", "o"],
    N: ["not applicable", "n"],
    P: ["prefer not to say", "p"],
  };

  const brazeGender = Object.keys(genders).find(key => genders[key].includes(gender.toLowerCase()));
  return brazeGender || gender;
}

function getAnonymousIdAlias(event: AnalyticsServerEvent, ctx: FullContext<BrazeCredentials>) {
  if (ctx.props.useJitsuAnonymousIdAlias && event.anonymousId) {
    return {
      alias_name: event.anonymousId,
      alias_label: "anonymous_id",
    };
  }
}

function getIdPart(event: AnalyticsServerEvent, ctx: FullContext<BrazeCredentials>) {
  let idPart = {} as any;
  const traits = event.traits || event.context?.traits || {};
  const user_alias = traits.user_alias || event.properties?.user_alias || getAnonymousIdAlias(event, ctx);
  const braze_id = traits.braze_id || event.properties?.braze_id;
  if (event.userId) {
    idPart.external_id = event.userId;
  } else if (user_alias) {
    idPart.user_alias = user_alias;
  } else if (braze_id) {
    idPart.braze_id = braze_id;
  }
  idPart.email = traits.email;
  idPart.phone = traits.phone;
  if (Object.keys(idPart).length === 0) {
    throw new Error('One of "external_id", "user_alias", "braze_id", "email" or "phone" is required.');
  }
  return idPart;
}

function trackEvent(event: AnalyticsServerEvent, ctx: FullContext<BrazeCredentials>): any {
  return {
    events: [
      {
        ...getIdPart(event, ctx),
        app_id: ctx.props.appId,
        name: event.event,
        time: new Date(eventTimeSafeMs(event)).toISOString(),
        properties: event.properties,
        _update_existing_only: false,
      },
    ],
  };
}

function trackPurchase(event: AnalyticsServerEvent, ctx: FullContext<BrazeCredentials>): any {
  const products = event.properties?.products as any[];
  if (!products || !products.length) {
    return;
  }
  const reservedKeys = ["product_id", "currency", "price", "quantity"];
  const event_properties = omit(event.properties, ["products"]);
  const base = {
    ...getIdPart(event, ctx),
    app_id: ctx.props.appId,
    time: new Date(eventTimeSafeMs(event)).toISOString(),
    _update_existing_only: false,
  };
  return {
    purchases: products.map(product => ({
      ...base,
      product_id: product.product_id,
      currency: product.currency ?? "USD",
      price: product.price,
      quantity: product.quantity,
      properties: {
        ...omit(product, reservedKeys),
        ...event_properties,
      },
    })),
  };
}

function updateUserProfile(event: AnalyticsServerEvent, ctx: FullContext<BrazeCredentials>): any {
  const geo = ctx.geo || ({} as any);
  const traits = event.traits || ({} as any);
  const knownProps = [
    "country",
    "current_location",
    "date_of_first_session",
    "date_of_last_session",
    "dob",
    "email",
    "email_subscribe",
    "email_open_tracking_disabled",
    "email_click_tracking_disabled",
    "facebook",
    "first_name",
    "home_city",
    "image_url",
    "language",
    "last_name",
    "marked_email_as_spam_at",
    "phone",
    "push_subscribe",
    "push_tokens",
    "time_zone",
    "twitter",
    "subscription_groups",
  ];
  return {
    attributes: [
      {
        ...getIdPart(event, ctx),
        country: ctx.geo?.country?.name,
        current_location:
          geo.location?.latitude && geo.location?.longitude
            ? {
                latitude: geo.location?.latitude,
                longitude: geo.location?.longitude,
              }
            : undefined,
        first_name: traits.firstName,
        last_name: traits.lastName,
        home_city: traits.address?.city,
        image_url: traits.avatar,
        time_zone: geo.location?.timezone,
        gender: toBrazeGender(traits.gender),
        ...pick(traits, knownProps),
        custom_attributes: omit(traits, knownProps),
        _update_existing_only: false,
      },
    ],
  };
}

function identifyUser(event: AnalyticsServerEvent, ctx: FullContext<BrazeCredentials>): any {
  const external_id = event.userId;
  const user_alias = event.traits?.user_alias || getAnonymousIdAlias(event, ctx);
  if (!external_id || !user_alias) {
    return;
  }
  return {
    aliases_to_identify: [
      {
        external_id,
        user_alias,
      },
    ],
    merge_behavior: "merge",
  };
}

const BrazeDestination: JitsuFunction<AnalyticsServerEvent, BrazeCredentials> = async (event, ctx) => {
  const endpoint = endpoints[ctx.props.endpoint];
  if (!endpoint) {
    throw new Error(`Unknown endpoint ${ctx.props.endpoint}`);
  }
  try {
    let httpRequests: HttpRequest[] = [];
    const headers = {
      "Content-type": "application/json",
      Authorization: `Bearer ${ctx.props.apiKey}`,
    };
    const url = `${endpoint}/users/track`;
    try {
      if (event.type === "identify") {
        httpRequests.push({
          url,
          payload: updateUserProfile(event, ctx),
          headers,
        });
        const identify = identifyUser(event, ctx);
        if (identify) {
          httpRequests.push({
            url: `${endpoint}/users/identify`,
            payload: identify,
            headers,
          });
        }
      } else if (event.type === "track" && event.event != "Order Completed") {
        httpRequests.push({
          url,
          payload: trackEvent(event, ctx),
          headers,
        });
      } else if (event.type === "track" && event.event === "Order Completed") {
        httpRequests.push({
          url,
          payload: trackPurchase(event, ctx),
          headers,
        });
      } else if ((event.type === "page" || event.type === "screen") && ctx.props.sendPageEvents) {
        const track = { ...event };
        track.event = event.type;
        const props = { ...event.properties };
        if (event.name) {
          props[`${event.type}_name`] = event.name;
        }
        if (event.category) {
          props[`${event.type}_category`] = event.category;
        }
        track.properties = props;
        httpRequests.push({
          url,
          payload: trackEvent(track, ctx),
          headers,
        });
      }
    } catch (e: any) {
      ctx.log.error(e);
      return false;
    }

    for (const httpRequest of httpRequests) {
      if (httpRequest.payload) {
        const method = httpRequest.method || "POST";
        const result = await ctx.fetch(httpRequest.url, {
          method,
          headers: httpRequest.headers,
          ...(httpRequest.payload ? { body: JSON.stringify(httpRequest.payload) } : {}),
        });
        if (result.status !== 200 && result.status !== 201) {
          throw new Error(
            `Braze ${method} ${httpRequest.url}:${
              httpRequest.payload ? `${JSON.stringify(httpRequest.payload)} --> ` : ""
            }${result.status} ${await result.text()}`
          );
        } else {
          ctx.log.debug(`Braze ${method} ${httpRequest.url}: ${result.status} ${await result.text()}`);
        }
      }
    }
  } catch (e: any) {
    throw new RetryError(e.message);
  }
};

BrazeDestination.displayName = "braze-destination";

BrazeDestination.description = "This functions covers jitsu events and sends them to Braze";

export default BrazeDestination;
