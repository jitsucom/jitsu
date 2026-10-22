// Browser-safe metadata shared by the console and the Reverse ETL runtime. No SDKs, no server code.
import { z } from "zod";

export const openAiAdsDestinationId = "openai-ads";
export const openAiAdsDestinationTitle = "OpenAI Ads (ChatGPT)";

const apiKey = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .regex(/^[!-~]+$/, `Invalid OpenAI ${label}`);
/**
 * Two keys from Ads Manager, each optional because each stream needs only its own (checked when a sync is saved and
 * again at run time): the Conversions API key (Conversions) only sends events to one account's pixels; the Ads API key
 * (Settings) is scoped to one ad account and manages its audiences.
 */
export const OpenAiAdsCredentials = z.object({
  conversionsApiKey: apiKey("Conversions API key")
    .optional()
    .describe(
      "Conversions API key::Create it in Ads Manager under Conversions. Needed for conversion syncs; it is only used to send events."
    ),
  adsApiKey: apiKey("Ads API key")
    .optional()
    .describe(
      "Ads API key::Create it in Ads Manager under Settings. Needed for audience syncs; it can manage this ad account, so use a key made for Jitsu."
    ),
});
export const OpenAiAdsCredentialsUi = {
  conversionsApiKey: { password: true },
  adsApiKey: { password: true },
};

/** Standard event names and the `data.type` OpenAI requires for each (developers.openai.com/ads/supported-events). */
export const openAiEventDataTypes = {
  app_installed: "customer_action",
  app_opened: "customer_action",
  appointment_scheduled: "customer_action",
  checkout_started: "contents",
  contents_viewed: "contents",
  custom: "custom",
  items_added: "contents",
  lead_created: "customer_action",
  order_created: "contents",
  page_viewed: "contents",
  registration_completed: "customer_action",
  subscription_created: "plan_enrollment",
  trial_started: "plan_enrollment",
} as const;
export const OpenAiEventType = z.enum(Object.keys(openAiEventDataTypes) as [keyof typeof openAiEventDataTypes]);
export const OpenAiActionSource = z.enum([
  "web",
  "mobile_app",
  "offline",
  "physical_store",
  "phone_call",
  "email",
  "other",
]);
export const openAiAppEvents: readonly string[] = ["app_installed", "app_opened"];

/** The pixel travels in the query string, so keep it to URL-safe characters. */
export const OpenAiPixelId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/, "Enter the Pixel ID from Ads Manager");
/** Lowercase, 1-64 characters, starts and ends with a letter or digit (OpenAI lowercases it for us). */
export const OpenAiCustomEventName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$/, "Use 1-64 letters, digits, _ or -");

const text = z.string().trim().max(2048).nullish();
// Shape is checked when the row is normalized, so a bad hash gets a readable message instead of a schema dump.
const hash = z.string().trim().max(128);
const multiText = z.union([z.string().trim().max(2048), z.array(z.string().trim().max(2048)).max(10)]).nullish();
const multiHash = z.union([hash, z.array(hash).max(10)]).nullish();
const parseJson = (value: unknown) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
/** Whole numbers. Strings from SQL numerics and warehouse readers (BigQuery returns INTEGER as a string) are accepted; fractions are not (that would be a silent rounding). */
const wholeNumber = z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number().int().safe());
const minorUnits = wholeNumber.nullish();
const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/)
  .nullish();
export const OpenAiContent = z
  .object({
    id: z.string().min(1).max(512).optional(),
    group_id: z.string().min(1).max(512).optional(),
    name: z.string().min(1).max(1024).optional(),
    content_type: z.string().min(1).max(128).optional(),
    quantity: wholeNumber.optional(),
    amount: wholeNumber.optional(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    variant_dict: z.record(z.string()).optional(),
  })
  .strict();

/** Flat row: the writer builds OpenAI's nested `user` and `data` objects. */
export const OpenAiConversionRow = z
  .object({
    __sourceKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    eventId: text,
    eventType: OpenAiEventType.nullish(),
    customEventName: text,
    eventTime: z.union([z.string(), z.number().finite()]).nullish(),
    actionSource: OpenAiActionSource.nullish(),
    sourceUrl: z.string().trim().max(2048).nullish(),
    // Opaque OpenAI value: passed through exactly as supplied, so no trimming.
    oppref: z.string().min(1).max(2048).nullish(),
    optOut: z.boolean().nullish(),
    amount: minorUnits,
    currency,
    planId: text,
    contents: z.preprocess(parseJson, z.array(OpenAiContent).max(1000)).nullish(),
    email: multiText,
    hashedEmail: multiHash,
    phone: multiText,
    hashedPhone: multiHash,
    externalId: multiText,
    hashedExternalId: multiHash,
    firstName: multiText,
    hashedFirstName: multiHash,
    lastName: multiText,
    hashedLastName: multiHash,
    region: multiText,
    city: multiText,
    postalCode: multiText,
    country: multiText,
    androidAdvertisingId: text,
    obref: text,
    ipAddress: z.string().ip().nullish(),
    userAgent: text,
  })
  .strict();

export const OpenAiConversionOptions = z
  .object({
    pixelId: OpenAiPixelId,
    eventType: OpenAiEventType.optional(),
    customEventName: OpenAiCustomEventName.optional(),
    actionSource: OpenAiActionSource.default("web"),
  })
  .strict();

/** Where the runner keeps the audience Jitsu created: intent and marker before the POST, the id after. */
export const openAiAudienceStateStream = "_REVERSE_ETL_OPENAI_AUDIENCE_";
export const OpenAiAudienceId = z
  .string()
  .trim()
  .regex(/^caud_[A-Za-z0-9_-]{4,128}$/, "Enter the audience ID from Ads Manager, for example caud_...");
/** One column per identifier type: a raw one or a pre-hashed one (checked together when the row is normalized). */
export const OpenAiAudienceRow = z
  .object({
    email: text,
    hashedEmail: hash.nullish(),
    phone: text,
    hashedPhone: hash.nullish(),
    gaid: text,
  })
  .strict();
export const OpenAiAudienceOptions = z
  .object({
    audience: z.discriminatedUnion("kind", [
      // The name needs at least three characters of which one is not whitespace (OpenAI's rule).
      z.object({ kind: z.literal("managed"), name: z.string().trim().min(3).max(1000) }).strict(),
      z.object({ kind: z.literal("existing"), audienceId: OpenAiAudienceId }).strict(),
    ]),
    exclusiveManagementConfirmed: z.boolean().optional(),
  })
  .strict();

export function validateOpenAiAdsReverseSettings(
  options: { stream: string; mode: "upsert" | "mirror"; streamOptions: unknown; mapping?: Record<string, string> },
  model: { cursor?: unknown; deleteColumn?: unknown },
  destination?: Record<string, unknown>
) {
  if (options.stream === "audience") return validateAudience(options, model, destination);
  if (options.stream !== "conversions") throw new Error("Unsupported OpenAI Ads Reverse ETL stream");
  if (destination && !(OpenAiAdsCredentials.safeParse(destination).success && destination.conversionsApiKey))
    throw new Error("Add the Conversions API key to this OpenAI Ads destination.");
  const parsed = OpenAiConversionOptions.safeParse(options.streamOptions);
  if (!parsed.success) throw new Error("Configure the OpenAI Pixel ID and valid event defaults.");
  if (options.mode !== "upsert" || model.deleteColumn)
    throw new Error("OpenAI conversions require insert mode and a model without a delete column");
  const mapping = options.mapping;
  if (!mapping) return;
  const settings = parsed.data;
  if (Object.keys(mapping).some(field => field === "__sourceKey" || !Object.hasOwn(OpenAiConversionRow.shape, field)))
    throw new Error("Unknown OpenAI conversion mapping field.");
  for (const [raw, hashed] of [
    ["email", "hashedEmail"],
    ["phone", "hashedPhone"],
    ["externalId", "hashedExternalId"],
    ["firstName", "hashedFirstName"],
    ["lastName", "hashedLastName"],
  ])
    if (mapping[raw] && mapping[hashed]) throw new Error("Choose raw or SHA-256 for each identifier, not both.");
  if (!settings.eventType && !mapping.eventType)
    throw new Error("Choose a default event type or map an event type column.");
  if (settings.eventType === "custom" && !settings.customEventName && !mapping.customEventName)
    throw new Error("Custom events need a custom event name: set a default or map a column.");
  if (!mapping.actionSource && settings.actionSource === "web" && !mapping.sourceUrl)
    throw new Error("Web events need a source URL: map the Source URL column or choose another action source.");
  if (!mapping.actionSource && settings.eventType && openAiAppEvents.includes(settings.eventType))
    if (settings.actionSource !== "mobile_app") throw new Error("App events require the mobile_app action source.");
}

function validateAudience(
  options: { mode: "upsert" | "mirror"; streamOptions: unknown; mapping?: Record<string, string> },
  model: { cursor?: unknown; deleteColumn?: unknown },
  destination?: Record<string, unknown>
) {
  if (destination && !(OpenAiAdsCredentials.safeParse(destination).success && destination.adsApiKey))
    throw new Error("Add the Ads API key to this OpenAI Ads destination.");
  const parsed = OpenAiAudienceOptions.safeParse(options.streamOptions);
  if (!parsed.success) throw new Error("Choose a managed audience name or an existing audience ID.");
  const settings = parsed.data;
  if (settings.audience.kind === "managed" && options.mode !== "mirror")
    throw new Error("Managed OpenAI audiences require mirror mode");
  if (options.mode === "mirror") {
    if (settings.audience.kind !== "managed" || model.cursor || model.deleteColumn)
      throw new Error(
        "OpenAI mirror requires a managed audience and a full-query model without a cursor or delete column"
      );
    if (!settings.exclusiveManagementConfirmed)
      throw new Error("Confirm exclusive management before mirroring an OpenAI audience");
  }
  const mapping = options.mapping;
  if (!mapping) return;
  if (Object.keys(mapping).some(field => !Object.hasOwn(OpenAiAudienceRow.shape, field)))
    throw new Error("Unknown OpenAI audience mapping field.");
  for (const [raw, hashed] of [
    ["email", "hashedEmail"],
    ["phone", "hashedPhone"],
  ])
    if (mapping[raw] && mapping[hashed]) throw new Error("Choose raw or SHA-256 for each identifier, not both.");
  if (!["email", "hashedEmail", "phone", "hashedPhone", "gaid"].some(field => mapping[field]))
    throw new Error("Map at least one member identifier: Email, Phone or Android advertising ID.");
}
