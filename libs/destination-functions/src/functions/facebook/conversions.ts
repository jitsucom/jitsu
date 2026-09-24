import { z } from "zod";
import type { JsonObject, ReverseEtlStream, WriteBatch } from "@jitsu/protocols/reverse-etl";
import type { DestinationServices, ReverseRuntimeAdapter } from "@jitsu/protocols/reverse-etl-runtime";
import { contentHash } from "../../reverse-etl/identity";
import { MetaConversionOptions, MetaConversionRow } from "./reverse-meta";
import { metaInvalid, metaUserData } from "./identifiers";
import { metaPrivacy } from "./audience";
import { MetaApiError, metaLog, metaRequest } from "./client";
import { accepted, assertContext, Context, MetaUncertainDelivery, rejected, savedReceipt } from "./delivery";

const wire = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), payload: z.record(z.unknown()) }).strict();
function eventTime(value: unknown) {
  if (value == null) return Math.floor(Date.now() / 1000);
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < 1e11) return value;
  if (typeof value === "string" && /^\d{1,10}$/.test(value)) return eventTime(Number(value));
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    metaInvalid();
  return Math.floor(Date.parse(value) / 1000);
}
export function normalizeMetaConversion(
  input: unknown,
  settings: z.infer<typeof MetaConversionOptions>,
  syncId: string
): JsonObject {
  const row = MetaConversionRow.parse(input) as Record<string, any>;
  if (!row.__sourceKey) metaInvalid();
  const user = metaUserData(row);
  if (
    !Object.keys(user).some(
      k =>
        !["client_user_agent", "page_id", "instagram_business_account_id", "whatsapp_business_account_id"].includes(k)
    )
  )
    metaInvalid();
  const actionSource = row.actionSource ?? settings.actionSource;
  const channel = row.messagingChannel ?? settings.messagingChannel;
  if (actionSource === "business_messaging") {
    if (
      !channel ||
      (channel === "messenger" && (!row.pageId || !row.pageScopedUserId)) ||
      (channel === "whatsapp" && (!row.whatsappBusinessAccountId || !row.ctwaClid)) ||
      (channel === "instagram" && (!row.instagramAccountId || !row.instagramScopedId))
    )
      metaInvalid();
  }
  if (
    row.dataProcessingOptions?.includes("LDU") &&
    (row.dataProcessingCountry == null ||
      ((!row.clientIpAddress || row.dataProcessingCountry !== 0) && row.dataProcessingState == null))
  )
    metaInvalid();
  if (actionSource === "website" && (!row.eventSourceUrl || !row.clientUserAgent)) metaInvalid();
  if (actionSource === "app") {
    const app = row.appData;
    if (
      !app ||
      ![0, 1].includes(app.advertiser_tracking_enabled) ||
      ![0, 1].includes(app.application_tracking_enabled) ||
      !Array.isArray(app.extinfo) ||
      app.extinfo.length !== 16 ||
      !["i2", "a2"].includes(app.extinfo[0])
    )
      metaInvalid();
  }
  const name = row.eventName || settings.eventName;
  if (!name || name.length > 256) metaInvalid();
  const custom = { ...row.customData };
  for (const [source, target] of [
    ["value", "value"],
    ["currency", "currency"],
    ["orderId", "order_id"],
    ["contentName", "content_name"],
    ["contentCategory", "content_category"],
    ["contentType", "content_type"],
    ["contentIds", "content_ids"],
    ["contents", "contents"],
    ["numItems", "num_items"],
    ["predictedLtv", "predicted_ltv"],
    ["status", "status"],
    ["searchString", "search_string"],
  ])
    if (row[source] != null) custom[target] = source === "currency" ? row[source].toUpperCase() : row[source];
  if (name === "Purchase" && (custom.value == null || !custom.currency)) metaInvalid();
  return JSON.parse(
    JSON.stringify({
      key: row.__sourceKey,
      payload: {
        event_name: name,
        event_time: eventTime(row.eventTime),
        event_id: row.eventId || `jitsu-${contentHash({ syncId, key: row.__sourceKey })}`,
        action_source: actionSource,
        ...(actionSource === "business_messaging" ? { messaging_channel: channel } : {}),
        user_data: user,
        ...(row.eventSourceUrl ? { event_source_url: row.eventSourceUrl } : {}),
        ...(Object.keys(custom).length ? { custom_data: custom } : {}),
        ...(row.appData ? { app_data: row.appData } : {}),
        ...(row.optOut != null ? { opt_out: row.optOut } : {}),
        ...metaPrivacy(row),
      },
    })
  );
}
export function createMetaConversions(
  credentials: JsonObject,
  inputOptions: unknown,
  syncId: string,
  services: DestinationServices
): ReverseRuntimeAdapter {
  const settings = MetaConversionOptions.parse(inputOptions);
  const options = settings as JsonObject;
  const targetIdentity = `meta-conversions:${settings.pixelId}`;
  const log = (message: string) => metaLog(services.log, message);
  const createWriter = async (ctx: Context) => {
    assertContext(ctx, targetIdentity, options, credentials);
    if (ctx.mode !== "upsert") throw new Error("Meta conversions are insert-only");
    return {
      init: async () => {},
      upsert: async (batch: WriteBatch<JsonObject>) => {
        if (!batch.records.length || batch.records.length > 1000) throw new Error("Invalid Meta conversion batch size");
        const data = batch.records.map(r => wire.parse(r.row).payload);
        try {
          const result = z
            .object({ events_received: z.number().int().nonnegative(), messages: z.array(z.unknown()).optional() })
            .safeParse(
              await metaRequest(
                ctx.fetch,
                String(credentials.accessToken),
                ctx.signal,
                `${settings.pixelId}/events`,
                "POST",
                {
                  data,
                  ...(settings.testEventCode ? { test_event_code: settings.testEventCode } : {}),
                }
              )
            );
          if (!result.success || result.data.events_received !== data.length) throw new MetaUncertainDelivery();
          await log(
            `Meta acknowledged ${data.length} conversion events; this does not measure matching or attribution.${
              result.data.messages?.length
                ? ` Meta returned ${result.data.messages.length} diagnostic messages; inspect Events Manager (raw messages may contain personal data).`
                : ""
            }`
          );
          return accepted(ctx, batch, "upsert");
        } catch (error) {
          if (error instanceof MetaApiError) {
            await log(
              `${error.message}; conversion request ${
                error.rejected ? "rejected" : "unconfirmed"
              }. No automatic write retry.`
            );
            // Meta documents whole-request rejection if any conversion event is invalid.
            if (error.rejected) return rejected(ctx, batch, "upsert", error);
          }
          throw error;
        }
      },
      finish: async () => ({ delivery: "accepted" as const }),
      abort: async () => {},
      reconcile: async () => {
        throw new MetaUncertainDelivery();
      },
    };
  };
  const stream: ReverseEtlStream<JsonObject, JsonObject, JsonObject> = {
    name: "conversions",
    displayName: "Conversions",
    options: MetaConversionOptions as z.ZodType<JsonObject>,
    rowType: MetaConversionRow.transform(row =>
      normalizeMetaConversion(row, settings, syncId)
    ) as z.ZodType<JsonObject>,
    batchSize: 1000,
    capabilities: { supportsUpsert: true, supportsExplicitRemove: false, mirror: "none", replay: "reconcile-required" },
    createWriter,
  };
  return {
    options,
    credentials,
    stream,
    targetIdentity,
    insertOnly: true,
    project: (_action, row) => {
      const parsed = wire.parse(row);
      return [{ identity: { eventKey: parsed.key }, upsert: parsed as JsonObject, remove: {} }];
    },
    recovery: () => ({
      attachWriter: createWriter,
      reconcileInit: async () => "absent" as const,
      reconcileAbort: async () => {},
      reconcileFinish: async () => ({ delivery: "accepted" as const }),
      reconcileBatch: async (batch, action, saved, ctx) => {
        assertContext(ctx, targetIdentity, options, credentials);
        if (action !== "upsert") throw new MetaUncertainDelivery();
        const prior = savedReceipt(ctx, batch, action, saved);
        if (prior) return prior;
        await log(
          "Meta conversion delivery is unconfirmed. Saved event IDs do not guarantee safe replay outside Meta's deduplication window. Contact your administrator; no conversions were resubmitted."
        );
        throw new MetaUncertainDelivery();
      },
    }),
  };
}
