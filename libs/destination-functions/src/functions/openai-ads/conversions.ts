import { z } from "zod";
import type { JsonObject, ReverseEtlStream, WriteBatch } from "@jitsu/protocols/reverse-etl";
import type { DestinationServices, ReverseRuntimeAdapter } from "@jitsu/protocols/reverse-etl-runtime";
import { contentHash } from "../../reverse-etl/identity";
import {
  OpenAiConversionOptions,
  OpenAiConversionRow,
  openAiAppEvents,
  openAiEventDataTypes,
  OpenAiCustomEventName,
} from "./reverse-meta";
import { openAiHashes } from "./identifiers";
import { invalidOpenAiConversion } from "./validation-errors";
import { OpenAiApiError, OpenAiTransportError, openAiLog, openAiSendEvents } from "./client";
import { accepted, assertContext, Context, OpenAiUncertainDelivery, rejected, savedReceipt } from "./delivery";

const wire = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), payload: z.record(z.unknown()) }).strict();
const dayMs = 24 * 60 * 60 * 1000;
const isoEventTime = z.string().datetime({ offset: true });

/** OpenAI wants Unix milliseconds within the last 7 days and at most 10 minutes ahead; anything else fails the batch. */
function eventTimeMs(value: unknown, now: number): number {
  if (value == null) return now;
  let ms: number;
  let numeric = false;
  if (typeof value === "number") {
    ms = value;
    numeric = true;
  } else if (typeof value === "string" && /^\d{1,16}$/.test(value.trim())) {
    ms = Number(value.trim());
    numeric = true;
  } else if (typeof value === "string" && isoEventTime.safeParse(value).success) {
    ms = Date.parse(value);
  } else return invalidOpenAiConversion("eventTime");
  if (!Number.isSafeInteger(ms)) invalidOpenAiConversion("eventTime");
  // A seconds-sized number would silently become January 1970: refuse it instead of guessing the unit.
  if (numeric && ms < 1e11) invalidOpenAiConversion("eventTime");
  if (ms < now - 7 * dayMs || ms > now + 10 * 60 * 1000) invalidOpenAiConversion("eventTime");
  return ms;
}

function list(values: string[], max = 3): string[] {
  const unique = [...new Set(values)];
  if (unique.length > max) invalidOpenAiConversion("userList");
  return unique;
}
function words(value: unknown, transform: (v: string) => string, max = 128): string[] {
  if (value == null || value === "") return [];
  return list(
    (Array.isArray(value) ? value : [value])
      .filter(v => v != null && v !== "")
      .map(v => transform(String(v)))
      .filter(v => {
        if (v.length > max) invalidOpenAiConversion("location");
        return v.length > 0;
      })
      .sort()
  );
}
function userObject(row: Record<string, any>): Record<string, unknown> {
  const user: Record<string, unknown> = {};
  const put = (key: string, values: string[]) => {
    if (values.length) user[key] = list(values);
  };
  put("emails_sha256", openAiHashes(row, "email", "hashedEmail"));
  put("phone_numbers_sha256", openAiHashes(row, "phone", "hashedPhone"));
  put("external_ids_sha256", openAiHashes(row, "externalId", "hashedExternalId"));
  put("first_names_sha256", openAiHashes(row, "firstName", "hashedFirstName"));
  put("last_names_sha256", openAiHashes(row, "lastName", "hashedLastName"));
  put(
    "regions",
    words(row.region, v => v.trim().toLowerCase())
  );
  put(
    "cities",
    words(row.city, v => v.trim().toLowerCase())
  );
  put(
    "postal_codes",
    words(
      row.postalCode,
      v => {
        const postal = v.trim();
        if (postal && !/^[A-Za-z0-9 -]{1,32}$/.test(postal)) invalidOpenAiConversion("location");
        return postal;
      },
      32
    )
  );
  put(
    "countries",
    words(row.country, v => {
      const country = v.trim().toUpperCase();
      if (country && !/^[A-Z]{2}$/.test(country)) invalidOpenAiConversion("location");
      return country;
    })
  );
  if (row.androidAdvertisingId) user.android_advertising_id = row.androidAdvertisingId;
  if (row.obref) user.obref = row.obref;
  if (row.ipAddress) user.ip_address = row.ipAddress;
  if (row.userAgent) user.user_agent = row.userAgent;
  return user;
}

export function normalizeOpenAiConversion(
  input: unknown,
  settings: z.infer<typeof OpenAiConversionOptions>,
  syncId: string,
  now = Date.now()
): JsonObject {
  const row = OpenAiConversionRow.parse(input) as Record<string, any>;
  if (!row.__sourceKey) invalidOpenAiConversion("identifier");
  const type = (row.eventType ?? settings.eventType) as keyof typeof openAiEventDataTypes | undefined;
  if (!type) invalidOpenAiConversion("eventType");
  const dataType = openAiEventDataTypes[type!];
  const actionSource = row.actionSource ?? settings.actionSource;
  if (openAiAppEvents.includes(type!) && actionSource !== "mobile_app") invalidOpenAiConversion("actionSource");
  if (row.sourceUrl || actionSource === "web") {
    // OpenAI rejects the whole batch for a URL without a scheme and host, and requires one for web events.
    let valid = false;
    try {
      valid = !!row.sourceUrl && !!new URL(row.sourceUrl).host;
    } catch {
      /* invalid below */
    }
    if (!valid) invalidOpenAiConversion("sourceUrl");
  }
  let customName: string | undefined;
  if (type === "custom") {
    const name = String(row.customEventName ?? settings.customEventName ?? "").trim();
    if (!OpenAiCustomEventName.safeParse(name).success || Object.hasOwn(openAiEventDataTypes, name.toLowerCase()))
      invalidOpenAiConversion("customEventName");
    customName = name.toLowerCase();
  }
  const data: Record<string, unknown> = { type: dataType };
  if (row.amount != null) {
    if (!row.currency) invalidOpenAiConversion("amount");
    data.amount = row.amount;
    data.currency = row.currency.toUpperCase();
  }
  if (row.contents?.length) {
    if (dataType === "customer_action") invalidOpenAiConversion("contents");
    data.contents = row.contents.map((item: Record<string, any>) =>
      item.currency ? { ...item, currency: item.currency.toUpperCase() } : item
    );
  }
  if (row.planId) {
    if (dataType !== "plan_enrollment" && dataType !== "custom") invalidOpenAiConversion("planId");
    data.plan_id = row.planId;
  }
  const user = userObject(row);
  return JSON.parse(
    JSON.stringify({
      key: row.__sourceKey,
      payload: {
        id: row.eventId || `jitsu-${contentHash({ syncId, key: row.__sourceKey })}`,
        type,
        timestamp_ms: eventTimeMs(row.eventTime, now),
        action_source: actionSource,
        ...(customName ? { custom_event_name: customName } : {}),
        ...(row.sourceUrl ? { source_url: row.sourceUrl } : {}),
        ...(row.oppref ? { oppref: row.oppref } : {}),
        ...(Object.keys(user).length ? { user } : {}),
        ...(row.optOut != null ? { opt_out: row.optOut } : {}),
        data,
      },
    })
  );
}

export function createOpenAiConversions(
  credentials: JsonObject,
  inputOptions: unknown,
  syncId: string,
  services: DestinationServices
): ReverseRuntimeAdapter {
  const settings = OpenAiConversionOptions.parse(inputOptions);
  const options = settings as JsonObject;
  const targetIdentity = `openai-conversions:${settings.pixelId}`;
  const log = (message: string) => openAiLog(services.log, message);
  const createWriter = async (ctx: Context) => {
    assertContext(ctx, targetIdentity, options, credentials);
    if (ctx.mode !== "upsert") throw new Error("OpenAI conversions are insert-only");
    return {
      init: async () => {},
      upsert: async (batch: WriteBatch<JsonObject>) => {
        if (!batch.records.length || batch.records.length > 1000)
          throw new Error("Invalid OpenAI conversion batch size");
        const events = batch.records.map(r => wire.parse(r.row).payload);
        try {
          await openAiSendEvents(
            ctx.fetch,
            String(credentials.conversionsApiKey),
            settings.pixelId,
            ctx.signal,
            events
          );
          await log(
            `OpenAI acknowledged ${events.length} conversion events; this does not measure matching or attribution.`
          );
          return accepted(ctx, batch);
        } catch (error) {
          if (error instanceof OpenAiApiError) {
            await log(
              `${error.message}; conversion request ${
                error.rejected ? "rejected" : "unconfirmed"
              }. No automatic write retry.`
            );
            // OpenAI fails the whole batch if any event is invalid, and does not say which one.
            if (error.rejected) return rejected(ctx, batch, error);
            throw new OpenAiUncertainDelivery();
          }
          if (error instanceof OpenAiTransportError) {
            await log(
              "OpenAI did not return a verifiable response; conversion request unconfirmed. No automatic write retry."
            );
            throw new OpenAiUncertainDelivery();
          }
          throw error;
        }
      },
      finish: async () => ({ delivery: "accepted" as const }),
      abort: async () => {},
      reconcile: async () => {
        throw new OpenAiUncertainDelivery();
      },
    };
  };
  const stream: ReverseEtlStream<JsonObject, JsonObject, JsonObject> = {
    name: "conversions",
    displayName: "Conversions",
    options: OpenAiConversionOptions as z.ZodType<JsonObject>,
    rowType: OpenAiConversionRow.transform(row =>
      normalizeOpenAiConversion(row, settings, syncId)
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
        if (action !== "upsert") throw new OpenAiUncertainDelivery();
        const prior = savedReceipt(ctx, batch, saved);
        if (prior) return prior;
        await log(
          "OpenAI conversion delivery is unconfirmed. Saved event IDs do not guarantee safe replay outside OpenAI's deduplication window. Contact your administrator; no conversions were resubmitted."
        );
        throw new OpenAiUncertainDelivery();
      },
    }),
  };
}
