import { JitsuFunction, FullContext } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { RetryError } from "@jitsu/functions-lib";
import { createFilter, eventTimeSafeMs } from "@jitsu/core-functions-lib";
import { deepMerge } from "juava";
import NodeCache from "node-cache";
import { GoogleAdsCredentials } from "../meta";
import { getOauthCreds } from "./lib/oauth";
import { hashPii } from "./lib/pii";
import { getTraits, splitName } from "./lib/contacts";

// Google offers two ways to import conversions and they carry the same information under different
// names, so this function builds one canonical Conversion and hands it to one of two serializers.
//
//  * Data Manager API (default) — https://developers.google.com/data-manager/api
//    Google's designated replacement. No developer token, single `datamanager` OAuth scope.
//  * Google Ads API `UploadClickConversions` (legacy) —
//    https://developers.google.com/google-ads/api/docs/conversions/upload-clicks
//    Closed to new adopters since 2026-06-15 and needs an approved developer token. Kept for
//    accounts that were already allowlisted.
const DATA_MANAGER_URL = "https://datamanager.googleapis.com/v1/events:ingest";
const GOOGLE_ADS_API_VERSION = "v22";

// gclid is valid for up to 90 days after the click, which is how long we keep one around for a
// user who converts on a later visit.
const CLICK_ID_TTL = "90d";
const CLICK_ID_KEY_PREFIX = "gads_click:";

const tokenCache = new NodeCache({ stdTTL: 800, checkperiod: 30, useClones: false });

type ClickIds = {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  dclid?: string;
};

const CLICK_ID_NAMES: (keyof ClickIds)[] = ["gclid", "gbraid", "wbraid", "dclid"];

type ConsentState = "GRANTED" | "DENIED";

// Raw (un-hashed) user data. Hashing happens once in hashUser() so both serializers place identical
// digests under their own field names.
type UserInfo = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  countryCode?: string;
  postalCode?: string;
};

type HashedUser = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  countryCode?: string;
  postalCode?: string;
};

type CartItem = {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
};

type Conversion = {
  conversionActionId: string;
  timestampMs: number;
  // The advertiser's own order ID, when the event actually carries one. Enhanced Conversions for Web
  // joins on this against what the on-page tag reported, so it must never be a synthesised value.
  orderId?: string;
  // Dedup key. Falls back to messageId, which is fine for deduplicating new conversions but useless
  // for matching an existing one — hence kept separate from orderId.
  transactionId?: string;
  value?: number;
  currency?: string;
  clickIds: ClickIds;
  user: HashedUser;
  consent: { adUserData?: ConsentState; adPersonalization?: ConsentState };
  ip?: string;
  userAgent?: string;
  device: {
    browser?: string;
    browserVersion?: string;
    operatingSystem?: string;
    operatingSystemVersion?: string;
    model?: string;
    brand?: string;
    category?: string;
    languageCode?: string;
    screenWidth?: number;
    screenHeight?: number;
  };
  cart?: { items: CartItem[]; merchantId?: string; transactionDiscount?: number };
  eventSource: GoogleAdsCredentials["eventSource"];
};

/**
 * Google normalizes gmail/googlemail local parts before hashing: dots are insignificant and
 * everything from a `+` is a tag. Other providers are left alone.
 * https://developers.google.com/google-ads/api/docs/conversions/enhanced-conversions/leads
 */
export function normalizeEmail(email: string | undefined): string | undefined {
  if (!email) {
    return undefined;
  }
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) {
    return undefined;
  }
  const domain = trimmed.slice(at + 1);
  let local = trimmed.slice(0, at);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const plus = local.indexOf("+");
    if (plus >= 0) {
      local = local.slice(0, plus);
    }
    local = local.replace(/\./g, "");
  }
  return local ? `${local}@${domain}` : undefined;
}

/**
 * Google requires E.164 — a leading `+` followed by digits. Numbers that already carry a `+` are
 * kept as-is; otherwise the configured default country code is prepended. Without either we can't
 * produce a valid E.164 number, so we send nothing rather than a value Google will reject.
 */
export function normalizePhoneE164(phone: string | undefined, defaultCountryCode?: string): string | undefined {
  if (!phone) {
    return undefined;
  }
  const trimmed = String(phone).trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/[^\d]/g, "");
    return digits ? `+${digits}` : undefined;
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) {
    return undefined;
  }
  const cc = (defaultCountryCode || "").replace(/[^\d]/g, "");
  return cc ? `+${cc}${digits.replace(/^0+/, "")}` : undefined;
}

function consentState(value: any): ConsentState | undefined {
  if (value === true) {
    return "GRANTED";
  }
  if (value === false) {
    return "DENIED";
  }
  return value === "GRANTED" || value === "DENIED" ? value : undefined;
}

/** Strip dashes/spaces from a customer id — Google Ads shows it as XXX-XXX-XXXX but the API wants digits. */
function normalizeCustomerId(id: string | undefined): string {
  return (id || "").replace(/[^\d]/g, "");
}

function firstString(...values: any[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
    if (typeof v === "number" && !isNaN(v)) {
      return String(v);
    }
  }
  return undefined;
}

function toNumber(value: any): number | undefined {
  if (typeof value === "number") {
    return isNaN(value) ? undefined : value;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return isNaN(n) ? undefined : n;
  }
  return undefined;
}

/** Drop undefined/null/empty-string values so we never send empty fields to Google. */
function compact<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ) as Partial<T>;
}

function undefinedIfEmpty<T extends Record<string, any>>(obj: T): T | undefined {
  return Object.keys(obj).length > 0 ? obj : undefined;
}

/**
 * Parse `eventName=conversionActionId` lines into a lookup. Values are trimmed; lines without an
 * `=` are ignored rather than failing the whole event.
 */
export function parseConversionActions(lines: string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of lines || []) {
    if (typeof line !== "string") {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const name = line.slice(0, eq).trim();
    const id = line.slice(eq + 1).trim();
    if (name && id) {
      result[name] = id;
    }
  }
  return result;
}

/** Pull click ids out of a URL's query string. */
function clickIdsFromUrl(url: string | undefined): ClickIds {
  if (!url) {
    return {};
  }
  const q = url.indexOf("?");
  if (q < 0) {
    return {};
  }
  const result: ClickIds = {};
  try {
    const params = new URLSearchParams(url.slice(q + 1));
    for (const name of CLICK_ID_NAMES) {
      const value = params.get(name);
      if (value) {
        result[name] = value;
      }
    }
  } catch (e) {
    // A malformed URL is not worth failing the event over.
  }
  return result;
}

/** Click ids carried on the event itself: the SDK's clientIds, then the page URL / search string. */
export function clickIdsFromEvent(event: AnalyticsServerEvent): ClickIds {
  const result: ClickIds = {};
  const clientIds = (event.context?.clientIds || {}) as Record<string, any>;
  for (const name of CLICK_ID_NAMES) {
    if (typeof clientIds[name] === "string" && clientIds[name]) {
      result[name] = clientIds[name];
    }
  }
  const page = event.context?.page || ({} as any);
  const fromUrl = { ...clickIdsFromUrl(page.url), ...clickIdsFromUrl(`?${(page.search || "").replace(/^\?/, "")}`) };
  for (const name of CLICK_ID_NAMES) {
    if (!result[name] && fromUrl[name]) {
      result[name] = fromUrl[name];
    }
  }
  return result;
}

/** The ids we key remembered click ids by. anonymousId first — it's the one present on every event. */
function clickIdStoreKeys(event: AnalyticsServerEvent): string[] {
  return [event.anonymousId, event.userId]
    .filter(id => typeof id === "string" && id)
    .map(id => `${CLICK_ID_KEY_PREFIX}${id}`);
}

/**
 * Resolve the click ids for this event, remembering any we see along the way.
 *
 * Rotor calls this function for *every* event on the connection (the `events` filter runs inside
 * the function), so a `gclid` that only ever appears on the landing page view is still observed
 * here and can be replayed onto a conversion that fires days later.
 *
 * The store is best-effort: self-hosted Jitsu without MONGODB_URL/REDIS_URL gets a dummy store,
 * so every failure here degrades to "no replay" instead of dropping the conversion.
 */
async function resolveClickIds(event: AnalyticsServerEvent, ctx: FullContext<GoogleAdsCredentials>): Promise<ClickIds> {
  const onEvent = clickIdsFromEvent(event);
  if (!ctx.props.storeClickIds) {
    return onEvent;
  }
  const keys = clickIdStoreKeys(event);
  if (keys.length === 0) {
    return onEvent;
  }
  if (Object.keys(onEvent).length > 0) {
    await rememberClickIds(ctx, keys, onEvent);
    return onEvent;
  }
  for (const key of keys) {
    try {
      const stored = await ctx.store.get(key);
      if (stored && typeof stored === "object") {
        const remembered = compact({
          gclid: stored.gclid,
          gbraid: stored.gbraid,
          wbraid: stored.wbraid,
          dclid: stored.dclid,
        }) as ClickIds;
        if (Object.keys(remembered).length > 0) {
          // Copy it onto the identifiers it isn't stored under yet. A click id first seen while the
          // user was anonymous is otherwise unreachable once they log in on another device and their
          // events carry only a userId.
          await rememberClickIds(
            ctx,
            keys.filter(k => k !== key),
            remembered
          );
          return remembered;
        }
      }
    } catch (e: any) {
      ctx.log.debug(`Google Ads: could not read remembered click ids from ${key}: ${e?.message}`);
    }
  }
  return onEvent;
}

/** Best-effort write of a click-id set under every identifier we know for this user. */
async function rememberClickIds(ctx: FullContext<GoogleAdsCredentials>, keys: string[], clickIds: ClickIds) {
  for (const key of keys) {
    try {
      await ctx.store.set(key, clickIds, CLICK_ID_TTL);
    } catch (e: any) {
      ctx.log.debug(`Google Ads: could not remember click ids under ${key}: ${e?.message}`);
    }
  }
}

function collectUser(event: AnalyticsServerEvent, ctx: FullContext<GoogleAdsCredentials>): UserInfo {
  const traits = getTraits(event);
  const { first_name, last_name } = splitName(traits);
  const phoneRaw = ctx.props.phoneFieldName ? traits[ctx.props.phoneFieldName] : undefined;
  return {
    email: normalizeEmail(firstString(traits.email)),
    phone: normalizePhoneE164(firstString(phoneRaw), ctx.props.defaultPhoneCountryCode),
    firstName: first_name,
    lastName: last_name,
    countryCode: firstString(traits.country, traits.countryCode, ctx.geo?.country?.code),
    postalCode: firstString(traits.postalCode, traits.zip, traits.postal_code, ctx.geo?.postalCode?.code),
  };
}

function hashUser(user: UserInfo): HashedUser {
  return compact({
    email: hashPii(user.email),
    phone: hashPii(user.phone),
    firstName: hashPii(user.firstName),
    lastName: hashPii(user.lastName),
    // Google takes country and postal code in the clear — they carry too little entropy to hash.
    countryCode: user.countryCode?.trim().toUpperCase(),
    postalCode: user.postalCode?.trim(),
  });
}

function collectCart(event: AnalyticsServerEvent): Conversion["cart"] {
  const properties = event.properties || {};
  const products = Array.isArray(properties.products) ? properties.products : undefined;
  if (!products || products.length === 0) {
    return undefined;
  }
  const items = products
    .map((p: any) =>
      compact({
        productId: firstString(p?.product_id, p?.productId, p?.sku, p?.id),
        quantity: toNumber(p?.quantity),
        unitPrice: toNumber(p?.price),
      })
    )
    .filter((item: CartItem) => Object.keys(item).length > 0);
  if (items.length === 0) {
    return undefined;
  }
  return compact({
    items,
    merchantId: firstString(properties.merchant_id, properties.merchantId),
    transactionDiscount: toNumber(properties.discount),
  }) as Conversion["cart"];
}

function buildConversion(
  event: AnalyticsServerEvent,
  ctx: FullContext<GoogleAdsCredentials>,
  conversionActionId: string,
  clickIds: ClickIds
): Conversion {
  const properties = event.properties || {};
  const context = event.context || ({} as any);
  const device = context.device || ({} as any);
  const screen = context.screen || ({} as any);
  const preferences = context.consent?.categoryPreferences;
  return {
    conversionActionId,
    timestampMs: eventTimeSafeMs(event),
    orderId: firstString(properties.orderId, properties.order_id, properties.transactionId),
    transactionId: firstString(properties.orderId, properties.order_id, properties.transactionId, event.messageId),
    value: toNumber(properties.total ?? properties.value ?? properties.revenue),
    currency: firstString(properties.currency),
    clickIds,
    user: hashUser(collectUser(event, ctx)),
    consent: compact({
      adUserData: consentState(preferences?.ad_user_data),
      adPersonalization: consentState(preferences?.ad_personalization),
    }),
    ip: firstString(context.ip)?.split(",")[0],
    userAgent: firstString(context.userAgent),
    device: compact({
      browser: firstString(device.browser, ctx.ua?.browser?.name),
      browserVersion: firstString(ctx.ua?.browser?.version),
      operatingSystem: firstString(context.os?.name, ctx.ua?.os?.name),
      operatingSystemVersion: firstString(context.os?.version, ctx.ua?.os?.version),
      model: firstString(device.model),
      brand: firstString(device.manufacturer, device.brand),
      category: firstString(device.type),
      languageCode: firstString(context.locale)?.split("-")[0],
      screenWidth: toNumber(screen.width),
      screenHeight: toNumber(screen.height),
    }),
    cart: collectCart(event),
    eventSource: ctx.props.eventSource,
  };
}

function userIdentifiersForDataManager(user: HashedUser) {
  const identifiers: any[] = [];
  if (user.email) {
    identifiers.push({ emailAddress: user.email });
  }
  if (user.phone) {
    identifiers.push({ phoneNumber: user.phone });
  }
  // AddressInfo is matched as a unit and Google requires all four parts, so send it only when complete.
  if (user.firstName && user.lastName && user.countryCode && user.postalCode) {
    identifiers.push({
      address: {
        givenName: user.firstName,
        familyName: user.lastName,
        regionCode: user.countryCode,
        postalCode: user.postalCode,
      },
    });
  }
  return identifiers;
}

/** https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest */
export function toDataManagerPayload(conversion: Conversion, props: GoogleAdsCredentials) {
  const customerId = normalizeCustomerId(props.customerId);
  const loginCustomerId = normalizeCustomerId(props.loginCustomerId);
  const identifiers = userIdentifiersForDataManager(conversion.user);
  const event = compact({
    eventTimestamp: new Date(conversion.timestampMs).toISOString(),
    eventSource: conversion.eventSource,
    // Enhanced Conversions for Web joins to the tag-recorded conversion on this field, so it has to be
    // the real order ID — never the messageId fallback.
    transactionId: props.conversionType === "enhancement" ? conversion.orderId : conversion.transactionId,
    conversionValue: conversion.value,
    currency: conversion.currency,
    adIdentifiers: undefinedIfEmpty(compact(conversion.clickIds)),
    userData: identifiers.length > 0 ? { userIdentifiers: identifiers } : undefined,
    consent: undefinedIfEmpty(
      compact({
        adUserData: conversion.consent.adUserData ? `CONSENT_${conversion.consent.adUserData}` : undefined,
        adPersonalization: conversion.consent.adPersonalization
          ? `CONSENT_${conversion.consent.adPersonalization}`
          : undefined,
      })
    ),
    eventDeviceInfo: undefinedIfEmpty(
      compact({
        ...conversion.device,
        ipAddress: conversion.ip,
        userAgent: conversion.userAgent,
      })
    ),
    cartData: conversion.cart
      ? compact({
          merchantId: conversion.cart.merchantId,
          transactionDiscount: conversion.cart.transactionDiscount,
          items: conversion.cart.items.map(item =>
            compact({ itemId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })
          ),
        })
      : undefined,
  });
  return compact({
    destinations: [
      compact({
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: customerId },
        loginAccount: loginCustomerId ? { accountType: "GOOGLE_ADS", accountId: loginCustomerId } : undefined,
        productDestinationId: conversion.conversionActionId,
      }),
    ],
    // Required whenever userData is present; harmless otherwise.
    encoding: identifiers.length > 0 ? "HEX" : undefined,
    events: [event],
    validateOnly: props.validateOnly || undefined,
  });
}

/**
 * Format for the legacy API's conversionDateTime: `yyyy-mm-dd hh:mm:ss+|-hh:mm`. The timezone is
 * mandatory; we always emit UTC.
 */
export function formatGoogleAdsDateTime(timestampMs: number): string {
  return `${new Date(timestampMs).toISOString().slice(0, 19).replace("T", " ")}+00:00`;
}

/** https://developers.google.com/google-ads/api/docs/conversions/upload-clicks */
function userIdentifiersForGoogleAds(user: HashedUser) {
  const userIdentifiers: any[] = [];
  if (user.email) {
    userIdentifiers.push({ hashedEmail: user.email });
  }
  if (user.phone) {
    userIdentifiers.push({ hashedPhoneNumber: user.phone });
  }
  if (user.firstName && user.lastName && user.countryCode && user.postalCode) {
    userIdentifiers.push({
      addressInfo: {
        hashedFirstName: user.firstName,
        hashedLastName: user.lastName,
        countryCode: user.countryCode,
        postalCode: user.postalCode,
      },
    });
  }
  return userIdentifiers;
}

export function toGoogleAdsPayload(conversion: Conversion, props: GoogleAdsCredentials) {
  const customerId = normalizeCustomerId(props.customerId);
  const userIdentifiers = userIdentifiersForGoogleAds(conversion.user);
  return compact({
    conversions: [
      compact({
        conversionAction: `customers/${customerId}/conversionActions/${conversion.conversionActionId}`,
        conversionDateTime: formatGoogleAdsDateTime(conversion.timestampMs),
        conversionValue: conversion.value,
        currencyCode: conversion.currency,
        orderId: conversion.transactionId,
        gclid: conversion.clickIds.gclid,
        gbraid: conversion.clickIds.gbraid,
        wbraid: conversion.clickIds.wbraid,
        userIpAddress: conversion.ip,
        // This API only knows WEB and APP; other Jitsu event sources have no equivalent.
        conversionEnvironment:
          conversion.eventSource === "WEB" || conversion.eventSource === "APP" ? conversion.eventSource : undefined,
        userIdentifiers: userIdentifiers.length > 0 ? userIdentifiers : undefined,
        consent: undefinedIfEmpty(compact(conversion.consent)),
        cartData: conversion.cart
          ? compact({
              merchantId: conversion.cart.merchantId,
              items: conversion.cart.items.map(item =>
                compact({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })
              ),
            })
          : undefined,
      }),
    ],
    partialFailure: true,
    validateOnly: props.validateOnly || undefined,
  });
}

/**
 * Enhanced Conversions for Web on the legacy API. Unlike every other mode this is not a conversion
 * upload but an *adjustment*: the Google tag already recorded the conversion on the site, and this
 * attaches hashed user data to it, joined on the order ID the tag reported. Hence no click id and no
 * conversion value — only the identifiers.
 * https://developers.google.com/google-ads/api/docs/conversions/enhance-conversions
 */
export function toGoogleAdsAdjustmentPayload(conversion: Conversion, props: GoogleAdsCredentials) {
  const customerId = normalizeCustomerId(props.customerId);
  const userIdentifiers = userIdentifiersForGoogleAds(conversion.user);
  return compact({
    conversionAdjustments: [
      compact({
        conversionAction: `customers/${customerId}/conversionActions/${conversion.conversionActionId}`,
        adjustmentType: "ENHANCEMENT",
        adjustmentDateTime: formatGoogleAdsDateTime(conversion.timestampMs),
        orderId: conversion.orderId,
        userIdentifiers: userIdentifiers.length > 0 ? userIdentifiers : undefined,
        // Google recommends echoing the user agent of the original tagged conversion to help matching.
        userAgent: conversion.userAgent,
      }),
    ],
    partialFailure: true,
    validateOnly: props.validateOnly || undefined,
  });
}

async function getAccessToken(ctx: FullContext<GoogleAdsCredentials>): Promise<string> {
  const props = ctx.props;
  if (!props.authorized || !props.oauthConnectionId) {
    throw new Error(
      `Google Ads destination is not authorized. Open the destination in the Jitsu console and click "Authorize" to connect your Google account.`
    );
  }
  const cacheKey = `${ctx.destination.id}-${ctx.destination.updatedAt?.toString()}`;
  const cached = tokenCache.get<string>(cacheKey);
  if (cached) {
    return cached;
  }
  let oauth: any;
  try {
    oauth = await getOauthCreds(props.oauthIntegrationId!, props.oauthConnectionId);
  } catch (e: any) {
    throw new Error(
      `Google Ads destination could not obtain credentials for your Google account. Try re-authorizing the destination: ${e?.message}`
    );
  }
  const accessToken = oauth?.credentials?.access_token || oauth?.credentials?.raw?.access_token;
  if (!accessToken) {
    throw new Error(`Google Ads destination received no access token from Nango. Try re-authorizing the destination.`);
  }
  tokenCache.set(cacheKey, accessToken);
  return accessToken;
}

function tryParse(responseText: string) {
  try {
    return JSON.parse(responseText);
  } catch (e) {
    return responseText;
  }
}

const GoogleAdsDestination: JitsuFunction<AnalyticsServerEvent, GoogleAdsCredentials> = async (event, ctx) => {
  const props = ctx.props;

  // Runs before the event filter on purpose: a landing page view carrying a gclid is not itself a
  // conversion, but it's the only place we'll ever see that gclid.
  const clickIds = await resolveClickIds(event, ctx);

  if (!["track", "page", "screen"].includes(event.type)) {
    return;
  }
  const filter = createFilter(props.events || "");
  if (!filter(event.type, event.event)) {
    return;
  }

  const eventName = event.type === "track" ? event.event : event.type;
  const overrides = parseConversionActions(props.conversionActions);
  const conversionActionId = (eventName && overrides[eventName]) || props.conversionActionId;
  if (!conversionActionId) {
    ctx.log.debug(`Google Ads: no conversion action configured for event "${eventName}", skipping`);
    return;
  }

  const conversion = buildConversion(event, ctx, conversionActionId, clickIds);

  // Google needs at least one signal to attribute the conversion against. Country and postal code
  // alone don't count — they only ever travel as part of a complete address block.
  const hasClickId = Object.keys(compact(conversion.clickIds)).length > 0;
  const hasUserData = userIdentifiersForDataManager(conversion.user).length > 0;
  const isEnhancement = props.conversionType === "enhancement";
  const useDataManager = props.api !== "google-ads";

  if (isEnhancement) {
    // Enhanced Conversions for Web enriches a conversion the tag already recorded. Without an order
    // ID there is nothing to join to, and without user data there is nothing to add — Google accepts
    // such a request and silently matches nothing, so fail loudly here instead.
    if (!conversion.orderId) {
      ctx.log.debug(
        `Google Ads: event "${eventName}" has no order ID, which Enhanced Conversions for Web matches on, skipping`
      );
      return;
    }
    if (!hasUserData) {
      ctx.log.debug(
        `Google Ads: event "${eventName}" has no user identifiers to enhance the tagged conversion with, skipping`
      );
      return;
    }
  } else if (!hasClickId && !hasUserData && !(useDataManager && conversion.ip)) {
    // Data Manager accepts the device IP as a standalone identifier; the legacy API does not — there
    // `userIpAddress` only supplements a click id or user identifiers, so an IP-only upload is a
    // guaranteed rejection rather than a long shot.
    ctx.log.debug(`Google Ads: event "${eventName}" has no gclid or user identifiers to match on, skipping`);
    return;
  }

  const basePayload = useDataManager
    ? toDataManagerPayload(conversion, props)
    : isEnhancement
    ? toGoogleAdsAdjustmentPayload(conversion, props)
    : toGoogleAdsPayload(conversion, props);
  // Escape hatch mirroring `event.facebookEvent`: lets a transformation function hand-tune anything
  // this mapping doesn't cover.
  const payload =
    typeof event.googleAdsEvent === "object" && !Array.isArray(event.googleAdsEvent)
      ? deepMerge(basePayload, event.googleAdsEvent)
      : basePayload;

  const accessToken = await getAccessToken(ctx);
  const customerId = normalizeCustomerId(props.customerId);
  const loginCustomerId = normalizeCustomerId(props.loginCustomerId);
  // Data Manager expresses both modes through one endpoint; the legacy API splits them across two
  // services — enhancements are adjustments, not conversions.
  const legacyMethod = isEnhancement ? "uploadConversionAdjustments" : "uploadClickConversions";
  const url = useDataManager
    ? DATA_MANAGER_URL
    : `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:${legacyMethod}`;

  // A Google Ads developer token identifies the *application* calling the API, not the advertiser, so
  // Jitsu Cloud supplies its own and the per-destination field stays empty. Self-hosted installs
  // without the env var fall back to whatever the user pasted into the destination.
  // Mirrors the JITSU_MANAGED handling the Google Ads *source* uses in the console
  // (webapps/console/lib/server/oauth/services.ts).
  const developerToken = props.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!useDataManager && !developerToken) {
    throw new Error(
      `Google Ads API requires a developer token. Add one in the destination settings, or switch the API setting to Data Manager, which does not need one.`
    );
  }

  const result = await ctx.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(useDataManager
        ? {}
        : {
            "developer-token": developerToken!,
            ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
          }),
    },
    body: JSON.stringify(payload),
  });
  const responseText = await result.text();
  const responseJson = tryParse(responseText);
  ctx.log.debug(`Google Ads (${props.api}) ${url} ---> ${result.status} ${result.statusText}: ${responseText}`);

  if (!result.ok) {
    const message = `Google Ads API error. Called ${url}, got ${result.status} ${result.statusText} - ${responseText}`;
    // 4xx other than rate limiting means the payload or the configuration is wrong — retrying it
    // will fail the same way every time.
    if (result.status >= 400 && result.status < 500 && result.status !== 429) {
      throw new Error(message);
    }
    throw new RetryError(message);
  }

  // Both APIs can reject individual rows while still answering 200, so a status check alone would
  // silently drop conversions.
  if (typeof responseJson === "object" && responseJson !== null) {
    if (responseJson.partialFailureError) {
      throw new Error(`Google Ads API rejected the conversion: ${JSON.stringify(responseJson.partialFailureError)}`);
    }
    if (Array.isArray(responseJson.fieldWarnings) && responseJson.fieldWarnings.length > 0) {
      ctx.log.warn(`Google Ads accepted the event with warnings: ${JSON.stringify(responseJson.fieldWarnings)}`);
    }
  }
};

GoogleAdsDestination.displayName = "google-ads";

GoogleAdsDestination.description =
  "Send conversions to Google Ads via the Data Manager API or the legacy Google Ads API";

export default GoogleAdsDestination;
