import { z } from "zod";
import type {
  BatchResult,
  JsonObject,
  ReverseEtlContext,
  ReverseEtlStream,
  WriteBatch,
} from "@jitsu/protocols/reverse-etl";
import { contentHash } from "../../../reverse-etl/identity";
import { validateBatchResult } from "../../../reverse-etl/meta";
import { ReverseEtlManualReconciliationError } from "../../../reverse-etl/failure";
import { contactIdentifiers, fail, hex, nameHash, normalizePhone } from "../shared/identifiers";
import {
  GoogleConversionCredentials,
  GoogleConversionOptions,
  GoogleConversionStream,
  googleConversionLabels,
  googleConversionRows,
} from "./meta";
import type { GoogleAccessToken } from "../audience/runtime";

type Context = ReverseEtlContext<JsonObject, JsonObject>;
const wire = z.object({ key: hex, payload: z.record(z.unknown()) }).strict();
const compact = (value: Record<string, any>): any =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ""));
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    return fail("Conversion timestamps must include a timezone");
  return new Date(value).toISOString();
}
const adsTime = (value: unknown) =>
  timestamp(value)
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "+00:00");
function session(row: any) {
  if (row.sessionAttributesEncoded) return row.sessionAttributesEncoded;
  if (!row.sessionAttributes) return undefined;
  const s = row.sessionAttributes;
  return Buffer.from(
    JSON.stringify(
      compact({
        gad_source: s.gadSource,
        gad_campaignid: s.gadCampaignId,
        landing_page_url: s.landingPageUrl,
        session_start_time_usec: s.sessionStartTime
          ? String(Date.parse(timestamp(s.sessionStartTime)) * 1000)
          : undefined,
        landing_page_referrer: s.landingPageReferrer,
        landing_page_user_agent: s.landingPageUserAgent,
      })
    )
  ).toString("base64url");
}
function adsIdentifiers(row: any) {
  return contactIdentifiers(row).map(id => {
    if ("emailAddress" in id) return { hashedEmail: id.emailAddress };
    if ("phoneNumber" in id) return { hashedPhoneNumber: id.phoneNumber };
    if (!("address" in id)) throw new Error("Unsupported Google contact identifier");
    return {
      addressInfo: compact({
        hashedFirstName: id.address.givenName,
        hashedLastName: id.address.familyName,
        countryCode: id.address.regionCode,
        postalCode: id.address.postalCode,
        hashedStreetAddress: row.streetAddress ? nameHash(row.streetAddress) : row.hashedStreetAddress?.toLowerCase(),
        city: row.city,
        state: row.state,
      }),
    };
  });
}
function target(
  credentials: z.infer<typeof GoogleConversionCredentials>,
  options: z.infer<typeof GoogleConversionOptions>
) {
  return {
    operatingAccount: { accountType: "GOOGLE_ADS", accountId: credentials.customerId },
    ...(credentials.loginCustomerId
      ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: credentials.loginCustomerId } }
      : {}),
    productDestinationId: options.conversionActionId,
  };
}

/** Google Ads responses are positional; persist both accepted and rejected rows before failing. */
export function googleAdsOutcomes(batch: WriteBatch<JsonObject>, value: unknown): BatchResult {
  const response = z
    .object({
      results: z.array(z.record(z.unknown())).optional(),
      partialFailureError: z
        .object({
          code: z.number().optional(),
          details: z
            .array(
              z.object({
                errors: z
                  .array(
                    z.object({
                      errorCode: z.record(z.string()),
                      location: z.object({
                        fieldPathElements: z.array(
                          z.object({ fieldName: z.string(), index: z.number().int().optional() })
                        ),
                      }),
                    })
                  )
                  .optional(),
              })
            )
            .optional(),
        })
        .optional(),
    })
    .parse(value);
  const errors = new Map<number, string>();
  if (response.partialFailureError?.code) {
    for (const detail of response.partialFailureError.details ?? [])
      for (const error of detail.errors ?? []) {
        const field = error.location.fieldPathElements.find(p =>
          ["conversions", "conversion_adjustments", "conversionAdjustments"].includes(p.fieldName)
        );
        if (field?.index === undefined || field.index < 0 || field.index >= batch.records.length)
          return fail("Google partial failure has no valid row index; no replay");
        const code = Object.values(error.errorCode)[0];
        if (!code || !/^[A-Z][A-Z0-9_]{0,100}$/.test(code)) fail("Unrecognized Google error code");
        errors.set(field.index, code);
      }
    if (!errors.size) fail("Google partial failure cannot be assigned to records; no replay");
  }
  if (errors.size !== batch.records.length && (!response.results || response.results.length !== batch.records.length))
    fail("Google conversion response is incomplete; no replay");
  return {
    outcomes: batch.records.map(({ operationId }, index) => {
      const code = errors.get(index);
      if (code)
        return {
          operationId,
          status: "rejected" as const,
          code,
          safeReason: `Google rejected this conversion (${code})`,
        };
      if (!Object.keys(response.results![index]).length) fail("Google conversion outcome is missing; no replay");
      return { operationId, status: "accepted" as const };
    }),
  };
}

import { dataManagerBaseUrl, dataManagerHeaders } from "../clients/data-manager";
import { googleAdsBaseUrl, googleAdsHeaders } from "../clients/google-ads";

export function createGoogleConversions(
  name: GoogleConversionStream,
  credentialsInput: unknown,
  optionsInput: unknown,
  getToken: GoogleAccessToken,
  syncId: string,
  defaultDeveloperToken?: string
) {
  const credentials = GoogleConversionCredentials.parse(credentialsInput);
  const options = GoogleConversionOptions.parse(optionsInput);
  const dataManager = name === "click-conversions" && options.api !== "google-ads";
  if (name !== "click-conversions" && options.api === "data-manager")
    fail("Calls and adjustments require the Google Ads API");
  const developerToken = credentials.developerToken || defaultDeveloperToken;
  if (!dataManager && !developerToken)
    fail("Google Ads developer token required for this stream; configure it on the destination");
  const conversionAction = `customers/${credentials.customerId}/conversionActions/${options.conversionActionId}`;
  const destination = target(credentials, options);
  const targetIdentity = `google-conversion:${credentials.customerId}:${options.conversionActionId}:${name}`;
  function normalize(input: unknown): JsonObject {
    const row: any = googleConversionRows[name].parse(input);
    if (!row.__sourceKey) fail("Conversion is missing its model primary key");
    const consent = Object.fromEntries(
      ["adUserData", "adPersonalization"].map(field => [
        field,
        Object.hasOwn(row, field) ? row[field] ?? "UNSPECIFIED" : "GRANTED",
      ])
    );
    let payload: any;
    if (name === "conversion-adjustments") {
      const type = row.adjustmentType ?? options.adjustmentType;
      if (!type) fail("Choose an adjustment type or map its column");
      if (!row.orderId && (!row.gclid || !row.conversionTimestamp))
        fail("Adjustment requires order ID or GCLID and original conversion time");
      if (type === "RESTATEMENT" && row.restatementValue == null) fail("Restatement requires a value");
      const ids = type === "ENHANCEMENT" ? adsIdentifiers(row) : [];
      if (type === "ENHANCEMENT" && (!row.orderId || !ids.length))
        fail("Enhancement requires order ID and user identifiers");
      if (ids.length > 5) fail("Google accepts at most five conversion user identifiers");
      payload = compact({
        conversionAction,
        adjustmentType: type,
        adjustmentDateTime: adsTime(row.adjustmentTimestamp ?? new Date().toISOString()),
        orderId: row.orderId,
        gclidDateTimePair: !row.orderId
          ? { gclid: row.gclid, conversionDateTime: adsTime(row.conversionTimestamp) }
          : undefined,
        restatementValue:
          type === "RESTATEMENT"
            ? compact({ adjustedValue: row.restatementValue, currencyCode: row.restatementCurrency })
            : undefined,
        userIdentifiers: ids.length
          ? ids.map(id => ({ ...id, userIdentifierSource: options.dataSource ?? "FIRST_PARTY" }))
          : undefined,
        userAgent: type === "ENHANCEMENT" ? row.userAgent : undefined,
      });
    } else if (name === "call-conversions") {
      payload = compact({
        conversionAction,
        callerId: normalizePhone(row.callerId),
        callStartDateTime: adsTime(row.callTimestamp),
        conversionDateTime: adsTime(row.conversionTimestamp),
        conversionValue: row.value,
        currencyCode: row.currency,
        consent,
        customVariables: row.customVariables,
      });
    } else {
      if (dataManager && (row.merchantCountryCode || row.merchantLanguageCode))
        fail("Merchant feed country/language mappings require Google Ads API delivery");
      if (!dataManager && row.userAgent)
        fail(
          "Click event user agent requires Data Manager; Google Ads API accepts landing-page user agent via session attributes"
        );
      if (
        !dataManager &&
        row.conversionEnvironment &&
        !["APP", "WEB", "UNSPECIFIED"].includes(row.conversionEnvironment)
      )
        fail("Google Ads API conversion environment supports APP or WEB");
      const ids = contactIdentifiers(row);
      if (!dataManager && ids.some(id => "address" in id))
        fail(
          "Google Ads click conversions support email and phone, not address identifiers; use Data Manager for address matching"
        );
      if (ids.length > 5) fail("Google accepts at most five conversion user identifiers");
      if (!ids.length && !row.gclid && !row.gbraid && !row.wbraid && !session(row))
        fail("Click conversion requires an identifier or session attributes");
      const items = row.items?.map((item: any) => ({
        ...(dataManager ? { merchantProductId: item.productId } : { productId: item.productId }),
        quantity: item.quantity,
        unitPrice: item.price,
      }));
      const cart =
        row.items || row.merchantId
          ? compact({
              merchantId: row.merchantId,
              items,
              ...(dataManager
                ? { transactionDiscount: row.transactionDiscount }
                : {
                    localTransactionCost: row.transactionDiscount,
                    feedCountryCode: row.merchantCountryCode,
                    feedLanguageCode: row.merchantLanguageCode,
                  }),
            })
          : undefined;
      payload = dataManager
        ? compact({
            transactionId: row.orderId || `jitsu-${contentHash({ syncId, key: row.__sourceKey })}`,
            eventTimestamp: timestamp(row.conversionTimestamp),
            eventSource:
              !row.conversionEnvironment || row.conversionEnvironment === "UNSPECIFIED"
                ? "OTHER"
                : row.conversionEnvironment,
            conversionValue: row.value,
            currency: row.currency,
            userData: ids.length ? { userIdentifiers: ids } : undefined,
            consent: Object.fromEntries(
              Object.entries(consent).map(([key, value]) => [
                key,
                value === "GRANTED" || value === "DENIED" ? `CONSENT_${value}` : "CONSENT_STATUS_UNSPECIFIED",
              ])
            ),
            adIdentifiers: compact({
              gclid: row.gclid,
              gbraid: row.gbraid,
              wbraid: row.wbraid,
              sessionAttributes: session(row),
            }),
            eventDeviceInfo: compact({ ipAddress: row.userIpAddress, userAgent: row.userAgent }),
            cartData: cart,
            customVariables: row.customVariables
              ? Object.entries(row.customVariables).map(([variable, value]) => ({ variable, value: String(value) }))
              : undefined,
          })
        : compact({
            conversionAction,
            conversionDateTime: adsTime(row.conversionTimestamp),
            orderId: row.orderId || `jitsu-${contentHash({ syncId, key: row.__sourceKey })}`,
            conversionValue: row.value,
            currencyCode: row.currency,
            gclid: row.gclid,
            gbraid: row.gbraid,
            wbraid: row.wbraid,
            userIpAddress: row.userIpAddress,
            userIdentifiers: adsIdentifiers(row),
            consent,
            conversionEnvironment: row.conversionEnvironment,
            sessionAttributesEncoded: session(row),
            cartData: cart,
            customVariables: row.customVariables,
          });
    }
    return JSON.parse(JSON.stringify({ key: row.__sourceKey, payload }));
  }
  async function request(ctx: Context, path: string, body?: unknown) {
    ctx.signal.throwIfAborted();
    const token = await getToken(ctx.signal);
    try {
      const response = await ctx.fetch(`${dataManager ? dataManagerBaseUrl : googleAdsBaseUrl}${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: ctx.signal,
        headers: dataManager
          ? dataManagerHeaders(token)
          : googleAdsHeaders(token, developerToken!, credentials.loginCustomerId),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok)
        fail(`Google conversion API HTTP ${response.status}; check credentials and saved request status`);
      return await response.json();
    } catch {
      return fail("Google conversion request failed; delivery may be uncertain, no automatic replay");
    }
  }
  // Resolve custom-variable names read-only before sending a Google Ads batch.
  async function resolveVariables(ctx: Context, payloads: any[]) {
    if (!payloads.some(p => p.customVariables && Object.keys(p.customVariables).length)) return payloads;
    const schema = z.object({
      results: z
        .array(z.object({ conversionCustomVariable: z.object({ name: z.string(), resourceName: z.string() }) }))
        .default([]),
      nextPageToken: z.string().optional(),
    });
    const lookup = new Map<string, string>();
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page++) {
      const found = schema.parse(
        await request(ctx, `customers/${credentials.customerId}/googleAds:search`, {
          query:
            "SELECT conversion_custom_variable.name, conversion_custom_variable.resource_name FROM conversion_custom_variable",
          ...(pageToken ? { pageToken } : {}),
        })
      );
      for (const { conversionCustomVariable: variable } of found.results)
        lookup.set(variable.name, variable.resourceName);
      pageToken = found.nextPageToken;
      if (!pageToken) break;
    }
    if (pageToken) fail("Custom variable lookup exceeded its pagination limit");
    return payloads.map(p =>
      p.customVariables
        ? {
            ...p,
            customVariables: Object.entries(p.customVariables).map(([name, value]) => {
              const resource = lookup.get(name);
              if (!resource) fail("A mapped Google custom variable does not exist");
              return { conversionCustomVariable: resource, value: String(value) };
            }),
          }
        : p
    );
  }
  const binding = (ctx: Context, batch: WriteBatch<JsonObject>) =>
    contentHash({ targetIdentity, revision: ctx.configRevision, batch });
  async function submit(ctx: Context, batch: WriteBatch<JsonObject>): Promise<BatchResult> {
    if (!batch.records.length || batch.records.length > 2000) fail("Invalid Google conversion batch size");
    let payloads = batch.records.map(r => wire.parse(r.row).payload);
    // Auth and read-only lookup failures are known non-submissions, not uncertain writes.
    try {
      await getToken(ctx.signal);
      if (!dataManager) payloads = await resolveVariables(ctx, payloads);
    } catch {
      return {
        outcomes: batch.records.map(r => ({
          operationId: r.operationId,
          status: "rejected",
          code: "GOOGLE_SETUP_FAILED",
          safeReason:
            "Check Google authorization, developer token and custom-variable mappings; no conversions submitted",
        })),
      };
    }
    if (!dataManager) {
      const adjustment = name === "conversion-adjustments";
      const response = await request(
        ctx,
        `customers/${credentials.customerId}:${
          adjustment
            ? "uploadConversionAdjustments"
            : name === "call-conversions"
            ? "uploadCallConversions"
            : "uploadClickConversions"
        }`,
        {
          [adjustment ? "conversionAdjustments" : "conversions"]: payloads,
          partialFailure: true,
        }
      );
      return googleAdsOutcomes(batch, response);
    }
    const response = z
      .object({ requestId: z.string().min(1), fieldWarnings: z.array(z.unknown()).optional() })
      .parse(await request(ctx, "events:ingest", { destinations: [destination], events: payloads, encoding: "HEX" }));
    return {
      outcomes: batch.records.map(r => ({ operationId: r.operationId, status: "staged" })),
      remoteJobIds: [response.requestId],
      providerCheckpoint: {
        requestId: response.requestId,
        binding: binding(ctx, batch),
        warnings: !!response.fieldWarnings?.length,
      },
    };
  }
  async function reconcileBatch(
    batch: WriteBatch<JsonObject>,
    action: "upsert" | "remove",
    saved: BatchResult | undefined,
    ctx: Context
  ): Promise<BatchResult> {
    if (!dataManager || action !== "upsert" || !saved)
      return fail("Google conversion receipt unavailable; manual reconciliation required, no replay");
    validateBatchResult(batch, saved);
    const receipt = z
      .object({ requestId: z.string(), binding: hex, warnings: z.boolean() })
      .strict()
      .parse(saved.providerCheckpoint);
    if (
      receipt.binding !== binding(ctx, batch) ||
      saved.remoteJobIds?.length !== 1 ||
      saved.remoteJobIds[0] !== receipt.requestId ||
      saved.outcomes.some(r => r.status !== "staged")
    )
      fail("Google conversion receipt does not match this batch");
    const response = z
      .object({
        requestStatusPerDestination: z
          .array(
            z.object({
              destination: z.object({
                operatingAccount: z.object({ accountType: z.string(), accountId: z.string() }),
                loginAccount: z.object({ accountType: z.string(), accountId: z.string() }).optional(),
                productDestinationId: z.string(),
              }),
              requestStatus: z.string(),
              eventsIngestionStatus: z.object({ recordCount: z.string() }).optional(),
              errorInfo: z.unknown().optional(),
              warningInfo: z.unknown().optional(),
            })
          )
          .length(1),
      })
      .parse(await request(ctx, `requestStatus:retrieve?requestId=${encodeURIComponent(receipt.requestId)}`));
    const status = response.requestStatusPerDestination[0];
    if (contentHash(status.destination) !== contentHash(destination)) fail("Google conversion status target mismatch");
    if (["PROCESSING", "REQUEST_STATUS_UNKNOWN"].includes(status.requestStatus)) return saved;
    if (status.requestStatus === "FAILED")
      return {
        ...saved,
        outcomes: batch.records.map(r => ({
          operationId: r.operationId,
          status: "rejected",
          code: "GOOGLE_REQUEST_FAILED",
          safeReason: "Google rejected this conversion request",
        })),
      };
    if (
      status.requestStatus !== "SUCCESS" ||
      status.errorInfo !== undefined ||
      status.warningInfo !== undefined ||
      receipt.warnings ||
      status.eventsIngestionStatus?.recordCount !== String(batch.records.length)
    )
      throw new ReverseEtlManualReconciliationError();
    return { ...saved, outcomes: batch.records.map(r => ({ operationId: r.operationId, status: "accepted" })) };
  }
  const createWriter = async (ctx: Context) => {
    if (ctx.mode !== "upsert" || ctx.targetIdentity !== targetIdentity)
      fail("Conversion streams require insert mode and the configured target");
    return {
      init: async () => {},
      upsert: (batch: WriteBatch<JsonObject>) => submit(ctx, batch),
      finish: async () => ({ delivery: "accepted" as const }),
      abort: async () => {},
      reconcile: async () => fail("Reconcile conversion batches using their saved receipts"),
    };
  };
  const stream: ReverseEtlStream<JsonObject, JsonObject, JsonObject> = {
    name,
    displayName: googleConversionLabels[name],
    options: GoogleConversionOptions,
    rowType: googleConversionRows[name].transform(normalize) as z.ZodType<JsonObject>,
    batchSize: 1000,
    ...(dataManager ? { batchDelivery: "asynchronous" as const } : {}),
    capabilities: { supportsUpsert: true, supportsExplicitRemove: false, mirror: "none", replay: "reconcile-required" },
    createWriter,
  };
  return {
    stream,
    credentials: credentials as JsonObject,
    targetIdentity,
    insertOnly: true as const,
    project: (_action: "upsert" | "remove", row: unknown) => {
      const parsed = wire.parse(row);
      return [{ identity: { eventKey: parsed.key }, upsert: row as JsonObject, remove: {} }];
    },
    recovery: () => ({
      attachWriter: createWriter,
      reconcileBatch,
      reconcileInit: async () => "absent" as const,
      reconcileAbort: async () => {},
      reconcileFinish: async () => ({ delivery: "accepted" as const }),
    }),
  };
}
