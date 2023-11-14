import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { Ga4Credentials } from "../meta";
import { createFilter, eventTimeSafeMs } from "./lib";

const ReservedUserProperties = [
  "first_open_time",
  "first_visit_time",
  "last_deep_link_referrer",
  "user_id",
  "first_open_after_install",
];

const StandardProperties = ["title", "url", "path", "hash", "search", "width", "height"];

function removeProperties(properties: Record<string, any>, toRemove: string[]): Record<string, any> {
  for (const key of toRemove) {
    delete properties[key];
  }
  return properties;
}

type Ga4Request = {
  client_id: string;
  user_id?: string;
  timestamp_micros: number;
  user_properties?: Record<string, any>;
  events: Ga4Event[];
};

type Ga4Event = {
  name: string;
  params?: Record<string, any>;
};

type Ga4Item = {
  item_id: string;
  item_name: string;
  affiliation?: string;
  coupon?: string;
  creative_name?: string;
  creative_slot?: string;
  currency?: string;
  discount?: number;
  index?: number;
  item_brand?: string;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  item_category5?: string;
  item_list_id?: string;
  item_list_name?: string;
  item_variant?: string;
  location_id?: string;
  price?: number;
  promotion_id?: string;
  promotion_name?: string;
  quantity?: number;
};

function getItems(event: AnalyticsServerEvent): Ga4Item[] {
  if (!event.properties) return [];

  let items: Ga4Item[] = [];
  if (Array.isArray(event.properties.products)) {
    items = event.properties.products.map(getItem).filter(item => item != undefined) as Ga4Item[];
  } else {
    const item = getItem(event.properties);
    if (item) items.push(item);
  }
  return items;
}

function getItem(product: any): Ga4Item | undefined {
  if (!product.product_id || !product.name) return undefined;
  return {
    item_id: product.product_id,
    item_name: product.name,
    affiliation: product.affiliation,
    coupon: product.coupon,
    creative_name: product.creative_name,
    creative_slot: product.creative_slot,
    currency: product.currency,
    discount: product.discount,
    index: product.position,
    item_brand: product.brand,
    item_category: product.category,
    item_category2: product.category2,
    item_category3: product.category3,
    item_category4: product.category4,
    item_category5: product.category5,
    item_list_id: product.list_id,
    item_list_name: product.list_name,
    item_variant: product.variant,
    location_id: product.location_id,
    price: product.price,
    promotion_id: product.promotion_id,
    promotion_name: product.promotion_name,
    quantity: product.quantity,
  };
}

function getUserProperties(event: AnalyticsServerEvent): Record<string, any> {
  let userProperties: Record<string, any> = {};
  // const ua = parser(event.context?.userAgent);
  // userProperties["platform"] = { value: "web" };
  // userProperties["os"] = { value: ua.os?.name };
  // userProperties["os_version"] = { value: ua.os?.version };
  // userProperties["browser"] = { value: `${ua.browser?.name};${ua.browser?.version}` };
  // userProperties["device_category"] = { value: ua.device?.type };
  // userProperties["device_model"] = { value: ua.device?.model };
  // userProperties["device_brand"] = { value: ua.device?.vendor };
  // userProperties["language"] = { value: event.context?.locale };
  //
  // for (const [key, prop] of Object.entries(userProperties)) {
  //   //remove empty values
  //   if (prop.value == undefined) delete userProperties[key];
  // }

  // for (const [key, value] of Object.entries(event.context?.traits || {})) {
  //   if (
  //     !ReservedUserProperties.includes(key) &&
  //     !key.startsWith("google_") &&
  //     !key.startsWith("ga_") &&
  //     !key.startsWith("firebase_")
  //   ) {
  //     userProperties[key] = { value };
  //   }
  // }
  return userProperties;
}

function getClientId(event: AnalyticsServerEvent): string {
  return event.context?.clientIds?.ga4?.clientId || event.anonymousId || "";
}

function getSessionId(event: AnalyticsServerEvent, measurementId: string): string | undefined {
  return event.context?.clientIds?.ga4?.sessions?.[measurementId.replace("G-", "")];
}

function pageViewEvent(event: AnalyticsServerEvent): Ga4Event {
  const customProperties = {
    ...(event.context?.page || {}),
    ...(event.traits || {}),
    ...(event.context?.traits || {}),
    ...(event.properties || {}),
    userAgent: event.context?.userAgent,
  };
  return {
    name: "page_view",
    params: {
      page_location: customProperties.url || "",
      page_referrer: customProperties.referrer || "",
      page_title: customProperties.title || "",
    },
  };
}

function trackEvent(event: AnalyticsServerEvent): Ga4Event {
  const evp = event.properties || {};
  let params: Record<string, any> = {};
  let name;
  const eventName = event.event || event.name || event.type;
  switch (event.name) {
    case "Promotion Clicked":
      name = "select_promotion";
      params.creative_name = evp.creative_name;
      params.creative_slot = evp.creative;
      params.location_id = evp.position;
      params.promotion_id = evp.promotion_id;
      params.promotion_name = evp.promotion_name || evp.name;
      params.items = getItems(event);
      break;
    case "Product List Viewed":
      name = "view_item_list";
      params.item_list_id = evp.list_id;
      params.item_list_name = evp.category;
      params.items = getItems(event);
      break;
    case "Checkout Started":
      name = "begin_checkout";
      params.currency = evp.currency;
      params.value = evp.value || evp.total || evp.revenue;
      params.coupon = evp.coupon;
      params.items = getItems(event);
      break;
    case "Order Refunded":
      name = "refund";
      params.currency = evp.currency;
      params.transaction_id = evp.order_id;
      params.value = evp.total || evp.value || evp.revenue;
      params.coupon = evp.coupon;
      params.shipping = evp.shipping;
      params.affiliation = evp.affiliation;
      params.tax = evp.tax;
      params.items = getItems(event);
      break;
    case "Product Added":
      name = "add_to_cart";
      params.currency = evp.currency;
      params.value = evp.value || evp.total || evp.revenue;
      params.items = getItems(event);
      break;
    case "Payment Info Entered":
      name = "add_payment_info";
      params.currency = evp.currency;
      params.value = evp.value || evp.total || evp.revenue;
      params.coupon = evp.coupon;
      params.payment_type = evp.payment_method;
      params.items = getItems(event);
      break;
    case "Product Added to Wishlist":
      name = "add_to_wishlist";
      params.currency = evp.currency;
      params.value = evp.value || evp.total || evp.revenue;
      params.items = getItems(event);
      break;
    case "Product Viewed":
      name = "view_item";
      params.currency = evp.currency;
      params.value = evp.value || evp.total || evp.revenue;
      params.items = getItems(event);
      break;
    case "Signed Up":
      name = "sign_up";
      params.method = evp.type || evp.method;
      break;
    case "Order Completed":
      name = "purchase";
      params.currency = evp.currency;
      params.transaction_id = evp.order_id;
      params.value = evp.total || evp.value || evp.revenue;
      params.coupon = evp.coupon;
      params.shipping = evp.shipping;
      params.affiliation = evp.affiliation;
      params.tax = evp.tax;
      params.items = getItems(event);
      break;
    case "Promotion Viewed":
      name = "view_promotion";
      params.creative_name = evp.creative_name;
      params.creative_slot = evp.creative;
      params.location_id = evp.position;
      params.promotion_id = evp.promotion_id;
      params.promotion_name = evp.promotion_name || evp.name;
      params.items = getItems(event);
      break;
    case "Cart Viewed":
      name = "view_cart";
      params.currency = evp.currency;
      params.value = evp.value || evp.total || evp.revenue;
      params.items = getItems(event);
      break;
    case "Signed In":
      name = "login";
      params.method = evp.type || evp.method;
      break;
    case "Product Removed":
      name = "remove_from_cart";
      params.currency = evp.currency;
      params.value = evp.value || evp.total || evp.revenue;
      params.items = getItems(event);
      break;
    case "Products Searched":
      name = "search";
      params.search_term = evp.query;
      break;
    case "Product Clicked":
      name = "select_item";
      params.item_list_id = evp.list_id;
      params.item_list_name = evp.category;
      params.items = getItems(event);
      break;
    default:
      name = eventName;
      params = { ...evp };
      params = removeProperties(params, StandardProperties);
      params.currency = evp.currency;
      params.value = evp.value || evp.total || evp.revenue;
      break;
  }
  return {
    name,
    params,
  };
}

const Ga4Destination: JitsuFunction<AnalyticsServerEvent, Ga4Credentials> = async (event, ctx) => {
  if (typeof ctx.props.events !== "undefined") {
    const filter = createFilter(ctx.props.events || "");
    if (!filter(event.type, event.event)) {
      return;
    }
  }
  let gaRequest: Ga4Request | undefined = undefined;
  try {
    const clientId = getClientId(event);
    if (!clientId) {
      ctx.log.info(`Ga4: no client_id found for event ID: ${event.messageId}`);
      return;
    }
    const sessionId = getSessionId(event, ctx.props.measurementId);
    const userProperties = getUserProperties(event);
    const events: Ga4Event[] = [];

    switch (event.type) {
      case "page":
        events.push(pageViewEvent(event));
        break;
      case "track":
      case "alias":
      case "group":
      case "identify":
        events.push(trackEvent(event));
    }
    if (events.length === 0) {
      ctx.log.info(`Ga4: no GA4 event is mapped for event type: ${event.type} ID: ${event.messageId}`);
      return;
    }
    const debug = "";
    //const debug = ctx.props.validationMode ? "/debug" : "";
    const url = `https://www.google-analytics.com${debug}/mp/collect?measurement_id=${ctx.props.measurementId}&api_secret=${ctx.props.apiSecret}`;

    gaRequest = {
      client_id: clientId,
      user_id: event.userId,
      timestamp_micros: eventTimeSafeMs(event) * 1000,
      user_properties: userProperties,
      events: sessionId ? events.map(e => ({ ...e, params: { ...e.params, session_id: sessionId } })) : events,
    };

    const result = await ctx.fetch(url, {
      method: "POST",
      body: JSON.stringify(gaRequest),
    });

    // if (ctx.props.validationMode) {
    //   ctx.log.info(`Ga4:${JSON.stringify(gaRequest)} --> ${result.status}: ${await result.text()}`);
    // } else
    if (result.status !== 200 && result.status !== 204) {
      throw new Error(`Ga4:${JSON.stringify(gaRequest)} --> ${result.status} ${await result.text()}`);
    } else {
      ctx.log.debug(`Ga4:${JSON.stringify(gaRequest)} --> ${result.status}`);
    }
  } catch (e: any) {
    throw new RetryError(`Failed to send request to Ga4: ${JSON.stringify(gaRequest)}: ${e?.message}`);
  }
};

Ga4Destination.displayName = "ga4-destination";

Ga4Destination.description =
  "This functions covers jitsu events and sends them to Google Analytics 4 using The Google Analytics Measurement Protocol";

export default Ga4Destination;
