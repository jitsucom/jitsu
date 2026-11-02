import { isIP } from "node:net";
import { JitsuFunction } from "@jitsu/protocols/functions";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { RetryError } from "@jitsu/functions-lib";
import { createFilter, eventTimeSafeMs, getTraits } from "@jitsu/core-functions-lib";
import { deepMerge } from "juava";
import {
  OpenAiAdsDestinationCredentials,
  OpenAiCustomEventName,
  OpenAiEventType,
  openAiAppEvents,
  openAiEventDataTypes,
} from "./reverse-meta";
import { eventTimeMs, userObject } from "./event-fields";
import { openAiNormalize, OpenAiIdentifierField } from "./identifiers";
import { OpenAiApiError, OpenAiFetch, OpenAiTransportError, openAiSendEvents } from "./client";

type EventType = keyof typeof openAiEventDataTypes;

/** Segment-spec event names that have an obvious OpenAI counterpart. Everything else is sent as a custom event. */
export const openAiDefaultEventMap: Readonly<Record<string, EventType>> = {
  "Order Completed": "order_created",
  "Checkout Started": "checkout_started",
  "Product Added": "items_added",
  "Product Viewed": "contents_viewed",
  "Signed Up": "registration_completed",
  "Lead Generated": "lead_created",
  page: "page_viewed",
};

/** `eventName=openaiEvent` lines. Lines that are not a name and one of OpenAI's standard events are returned as invalid. */
export function parseOpenAiEventMappings(input: string | string[] | undefined): {
  mappings: Map<string, EventType>;
  invalid: string[];
} {
  const mappings = new Map<string, EventType>();
  const invalid: string[] = [];
  const lines = typeof input === "string" ? input.split(/\r?\n/) : input || [];
  for (const line of lines) {
    if (typeof line !== "string" || !line.trim()) continue;
    const eq = line.lastIndexOf("=");
    const name = eq > 0 ? line.slice(0, eq).trim() : "";
    const type = eq > 0 ? OpenAiEventType.safeParse(line.slice(eq + 1).trim()) : undefined;
    if (name && type?.success) mappings.set(name, type.data);
    else invalid.push(line);
  }
  return { mappings, invalid };
}

/** OpenAI lowercases names and allows 1-64 of a-z, 0-9, _ and -, starting and ending with a letter or digit. */
function sanitizeEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 64)
    .replace(/^[_-]+|[_-]+$/g, "");
}

function customEventName(name: string): string | undefined {
  const cleaned = sanitizeEventName(name);
  if (!cleaned || !OpenAiCustomEventName.safeParse(cleaned).success) return undefined;
  return Object.hasOwn(openAiEventDataTypes, cleaned) ? undefined : cleaned;
}

function minorUnits(value: unknown, currency: string): number | undefined {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return undefined;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    /* Unknown to ICU: keep two decimals. */
  }
  const minor = Math.round(n * 10 ** digits);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function oppref(event: AnalyticsServerEvent): string | undefined {
  const fromIds = (event.context?.clientIds as Record<string, unknown> | undefined)?.oppref;
  if (typeof fromIds === "string" && fromIds) return fromIds;
  const page = (event.context?.page || {}) as Record<string, any>;
  for (const source of [typeof page.url === "string" ? page.url.split("#")[0].split("?")[1] : undefined, page.search]) {
    if (typeof source !== "string" || !source) continue;
    try {
      const value = new URLSearchParams(source.replace(/^\?/, "")).get("oppref");
      if (value) return value;
    } catch {
      /* A malformed query string is not worth failing the event for. */
    }
  }
  return undefined;
}

function contents(properties: Record<string, any>, currency: string | undefined) {
  const source = Array.isArray(properties.products)
    ? properties.products
    : properties.product_id || properties.sku
    ? [properties]
    : [];
  const items: Record<string, unknown>[] = [];
  for (const p of source.slice(0, 1000)) {
    if (!p || typeof p !== "object") continue;
    const id = p.product_id ?? p.sku ?? p.id;
    const item: Record<string, unknown> = {};
    if (id != null && String(id) && String(id).length <= 512) item.id = String(id);
    if (typeof p.name === "string" && p.name && p.name.length <= 1024) item.name = p.name;
    const quantity = typeof p.quantity === "string" ? Number(p.quantity) : p.quantity;
    if (Number.isSafeInteger(quantity)) item.quantity = quantity;
    const amount = currency ? minorUnits(p.price, currency) : undefined;
    if (amount !== undefined) {
      item.amount = amount;
      item.currency = currency;
    }
    if (Object.keys(item).length) items.push(item);
  }
  return items;
}

export type OpenAiEventResult = { event: Record<string, unknown> } | { skip: string };

/**
 * Builds the Conversions API event for one analytics event, or says why it cannot be sent. Pure: no I/O, so it can be
 * tested directly. A skipped event is a decision about this event, never an error to retry.
 */
export function toOpenAiEvent(
  event: AnalyticsServerEvent,
  props: OpenAiAdsDestinationCredentials,
  now = Date.now()
): OpenAiEventResult {
  const name = event.type === "track" ? event.event : event.type;
  if (!name) return { skip: "the event has no name" };
  if (!event.messageId) return { skip: "the event has no message ID to deduplicate on" };
  const { mappings } = parseOpenAiEventMappings(props.eventMappings);
  // "Trial Started" is OpenAI's trial_started once sanitized; only "custom" itself cannot be used as a name.
  const sanitized = sanitizeEventName(name);
  const standard: EventType | undefined =
    mappings.get(name) ??
    // Own properties only: names like "constructor" or "toString" must reach the custom fallback.
    (Object.hasOwn(openAiDefaultEventMap, name) ? openAiDefaultEventMap[name] : undefined) ??
    (sanitized !== "custom" && Object.hasOwn(openAiEventDataTypes, sanitized) ? (sanitized as EventType) : undefined);
  const type: EventType = standard ?? "custom";
  const custom = type === "custom" ? customEventName(name) : undefined;
  if (type === "custom" && !custom) return { skip: `"${name}" cannot be turned into an OpenAI custom event name` };

  let timestamp: number;
  try {
    timestamp = eventTimeMs(eventTimeSafeMs(event), now);
  } catch {
    return { skip: "the event time is outside OpenAI's window (the last 7 days, at most 10 minutes ahead)" };
  }

  const actionSource = openAiAppEvents.includes(type) ? "mobile_app" : props.actionSource;
  const page = (event.context?.page || {}) as Record<string, any>;
  let sourceUrl: string | undefined;
  try {
    if (typeof page.url === "string" && new URL(page.url).host) sourceUrl = page.url;
  } catch {
    /* Not a usable URL: handled below. */
  }
  if (actionSource === "web" && !sourceUrl)
    return { skip: "web events need a page URL; send it with the event or choose another action source" };

  // Identifiers: one that OpenAI would refuse is left out, never the whole event.
  const traits = getTraits(event) as Record<string, unknown>;
  const row: Record<string, unknown> = {};
  const identifier = (field: OpenAiIdentifierField, values: unknown[]) => {
    const valid = [...new Set(values.filter((v): v is string => typeof v === "string" && !!v.trim()))].filter(v => {
      try {
        openAiNormalize(field, v);
        return true;
      } catch {
        return false;
      }
    });
    if (valid.length) row[field] = valid;
  };
  identifier("email", [traits.email]);
  if (props.phoneFieldName) identifier("phone", [traits[props.phoneFieldName]]);
  identifier(
    "externalId",
    [event.userId, event.anonymousId].map(v => (v == null ? undefined : String(v)))
  );
  const ip = typeof event.context?.ip === "string" ? event.context.ip.split(",")[0].trim() : "";
  if (ip && isIP(ip)) row.ipAddress = ip;
  if (typeof event.context?.userAgent === "string" && event.context.userAgent) row.userAgent = event.context.userAgent;
  const obref = (event.context?.clientIds as Record<string, unknown> | undefined)?.obref;
  if (typeof obref === "string" && obref) row.obref = obref;
  const user = userObject(row);

  const properties = (event.properties || {}) as Record<string, any>;
  const dataType = openAiEventDataTypes[type];
  const currency =
    typeof properties.currency === "string" && /^[A-Za-z]{3}$/.test(properties.currency)
      ? properties.currency.toUpperCase()
      : undefined;
  const data: Record<string, unknown> = { type: dataType };
  const amount = currency
    ? minorUnits(properties.total ?? properties.value ?? properties.revenue, currency)
    : undefined;
  const items = dataType === "customer_action" ? [] : contents(properties, currency);
  if (amount !== undefined) data.amount = amount;
  if (currency && (amount !== undefined || items.length)) data.currency = currency;
  if (items.length) data.contents = items;
  const planId = properties.plan_id ?? properties.planId;
  if ((dataType === "plan_enrollment" || dataType === "custom") && typeof planId === "string" && planId)
    data.plan_id = planId;

  const base = JSON.parse(
    JSON.stringify({
      id: event.messageId,
      type,
      timestamp_ms: timestamp,
      action_source: actionSource,
      ...(custom ? { custom_event_name: custom } : {}),
      ...(sourceUrl ? { source_url: sourceUrl } : {}),
      ...(oppref(event) ? { oppref: oppref(event) } : {}),
      ...(Object.keys(user).length ? { user } : {}),
      data,
    })
  );
  // Escape hatch, as for Meta (`facebookEvent`) and Google Ads (`googleAdsEvent`): a function can hand-tune any field.
  const override = (event as Record<string, unknown>).openaiAdsEvent;
  return {
    event:
      override && typeof override === "object" && !Array.isArray(override) ? deepMerge(base, override as any) : base,
  };
}

/**
 * Sends site and app events to OpenAI Ads through the Conversions API.
 * https://developers.openai.com/ads/conversions-api
 */
const OpenAiAdsDestination: JitsuFunction<AnalyticsServerEvent, OpenAiAdsDestinationCredentials> = async (
  event,
  ctx
) => {
  if (!["track", "page", "screen"].includes(event.type)) return;
  const parsed = OpenAiAdsDestinationCredentials.safeParse(ctx.props);
  if (!parsed.success) throw new Error("OpenAI Ads destination settings are invalid; open the destination and save it");
  const props = parsed.data;
  if (!createFilter(props.events || "")(event.type, event.event)) return;
  if (!props.pixelId) throw new Error("OpenAI event delivery requires a Pixel ID on the destination");
  if (!props.conversionsApiKey) throw new Error("OpenAI event delivery requires the Conversions API key");
  const { invalid } = parseOpenAiEventMappings(props.eventMappings);
  if (invalid.length)
    ctx.log.warn(`OpenAI Ads: ${invalid.length} event name line(s) ignored; use eventName=openaiEvent`);

  const built = toOpenAiEvent(event, props);
  if ("skip" in built) {
    ctx.log.debug(`OpenAI Ads: event ${event.messageId} not sent: ${built.skip}`);
    return;
  }
  // The shared sender wants the Reverse ETL fetch shape; the function context's fetch takes the same request.
  const send: OpenAiFetch = (url, o) => ctx.fetch(url, { method: o.method, headers: o.headers, body: o.body });
  try {
    await openAiSendEvents(send, props.conversionsApiKey, props.pixelId, new AbortController().signal, [built.event]);
  } catch (e: any) {
    // Messages carry only the status and OpenAI's short error codes, never the key or the event.
    if (e instanceof OpenAiApiError) {
      const message = `OpenAI Ads API error: HTTP ${e.status}${e.code ? ` (${e.code})` : ""}${
        e.details.length ? ` ${JSON.stringify(e.details)}` : ""
      }${
        // OpenAI answers a wrong pixel with a bare 403 ("unknown pid") and a wrong key with 401; its own text is not kept.
        e.status === 401 || e.status === 403
          ? ". Check the Pixel ID and the Conversions API key on the destination"
          : ""
      }`;
      // A refusal other than rate limiting would fail the same way every time; a retry carries the same event ID,
      // which OpenAI deduplicates.
      if (e.status >= 400 && e.status < 500 && e.status !== 429) throw new Error(message);
      throw new RetryError(message);
    }
    if (e instanceof OpenAiTransportError) throw new RetryError(e.message);
    throw e;
  }
  ctx.log.debug(`OpenAI Ads: event ${event.messageId} sent as ${built.event.type}`);
};

OpenAiAdsDestination.displayName = "openai-ads-destination";

OpenAiAdsDestination.description = "Send events to OpenAI Ads through the Conversions API";

export default OpenAiAdsDestination;
