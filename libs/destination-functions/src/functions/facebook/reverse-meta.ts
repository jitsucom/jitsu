// Browser-safe metadata shared by the console and Reverse ETL runtime.
import { z } from "zod";

export const MetaId = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{0,39}$/, "Enter a Meta numeric ID");
export const MetaToken = z
  .string()
  .trim()
  .min(1)
  .max(8192)
  .regex(/^[!-~]+$/, "Invalid Meta access token");
export const MetaReverseCredentials = z.object({ accessToken: MetaToken });
export const metaDestinationId = "facebook-conversions";
export const metaDestinationTitle = "Meta Ads (Facebook & Instagram)";
export const metaAudienceStateStream = "_REVERSE_ETL_META_AUDIENCE_";
export const MetaMessagingChannel = z.enum(["messenger", "whatsapp", "instagram"]);
export const MetaActionSource = z.enum([
  "website",
  "app",
  "email",
  "phone_call",
  "chat",
  "physical_store",
  "system_generated",
  "business_messaging",
  "other",
]);
const text = z.string().trim().max(2048).nullish();
const hash = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{64}$/)
  .nullish();
const number = z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number().finite());
export const MetaJsonObject = z.preprocess(value => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, z.record(z.unknown()));
export const MetaStringArray = z.preprocess(value => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, z.array(z.string()).max(100));

/** The audience and CAPI wire names differ, even where normalization is shared. */
export const metaContactFields = [
  ["email", "hashedEmail", "Email", "EMAIL", "em"],
  ["phone", "hashedPhone", "Phone (with country code)", "PHONE", "ph"],
  ["firstName", "hashedFirstName", "First name", "FN", "fn"],
  ["lastName", "hashedLastName", "Last name", "LN", "ln"],
  ["gender", "hashedGender", "Gender", "GEN", "ge"],
  ["city", "hashedCity", "City", "CT", "ct"],
  ["state", "hashedState", "State / province", "ST", "st"],
  ["postalCode", "hashedPostalCode", "Postal code", "ZIP", "zp"],
  ["country", "hashedCountry", "Country (two-letter code)", "COUNTRY", "country"],
] as const;
const contactShape = Object.fromEntries(
  metaContactFields.flatMap(([raw, hashed]) => [
    [raw, text],
    [hashed, hash],
  ])
);
const privacyShape = {
  dataProcessingOptions: MetaStringArray.nullish(),
  dataProcessingCountry: number.pipe(z.number().int().nonnegative()).nullish(),
  dataProcessingState: number.pipe(z.number().int().nonnegative()).nullish(),
};
export const MetaAudienceRow = z
  .object({
    ...contactShape,
    externalId: z.string().max(2048).nullish(),
    mobileAdvertisingId: text,
    firstInitial: text,
    hashedFirstInitial: hash,
    birthYear: text,
    hashedBirthYear: hash,
    birthMonth: text,
    hashedBirthMonth: hash,
    birthDay: text,
    hashedBirthDay: hash,
    pageScopedUserId: text,
    lookalikeValue: number.pipe(z.number().nonnegative()).nullish(),
    ...privacyShape,
  })
  .strict();
export const MetaAudienceOptions = z
  .object({
    accountId: z
      .string()
      .trim()
      .transform(value => value.replace(/^act_/, ""))
      .pipe(MetaId),
    audience: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("managed"), name: z.string().trim().min(1).max(180) }).strict(),
      z.object({ kind: z.literal("existing"), audienceId: MetaId }).strict(),
    ]),
    pageId: MetaId.optional(),
    valueBased: z.boolean().default(false),
    customerFileSource: z
      .enum(["USER_PROVIDED_ONLY", "PARTNER_PROVIDED_ONLY", "BOTH_USER_AND_PARTNER_PROVIDED"])
      .default("USER_PROVIDED_ONLY"),
    exclusiveManagementConfirmed: z.boolean().optional(),
  })
  .strict();

const multiText = z.union([z.string().trim().max(2048), z.array(z.string().trim().max(2048)).max(100)]).nullish();
const multiHash = z.union([hash.unwrap().unwrap(), z.array(hash.unwrap().unwrap()).max(100)]).nullish();
const conversionContactShape = Object.fromEntries(
  metaContactFields.flatMap(([raw, hashed]) => [
    [raw, multiText],
    [hashed, multiHash],
  ])
);
export const MetaConversionRow = z
  .object({
    ...conversionContactShape,
    __sourceKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    eventName: text,
    eventTime: z.union([z.string(), z.number().finite()]).nullish(),
    eventId: text,
    actionSource: MetaActionSource.nullish(),
    messagingChannel: MetaMessagingChannel.nullish(),
    eventSourceUrl: z.string().url().nullish(),
    externalId: z.union([z.string().max(2048), z.array(z.string().max(2048)).max(100)]).nullish(),
    hashedExternalId: multiHash,
    dateOfBirth: multiText,
    hashedDateOfBirth: multiHash,
    clientIpAddress: z.string().ip().nullish(),
    clientUserAgent: text,
    fbc: text,
    fbp: text,
    subscriptionId: text,
    facebookLoginId: MetaId.nullish(),
    leadId: MetaId.nullish(),
    mobileAdvertisingId: text,
    anonymousId: text,
    pageId: MetaId.nullish(),
    pageScopedUserId: MetaId.nullish(),
    ctwaClid: text,
    whatsappBusinessAccountId: MetaId.nullish(),
    instagramAccountId: MetaId.nullish(),
    instagramScopedId: MetaId.nullish(),
    value: number.nullish(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .nullish(),
    orderId: text,
    contentName: text,
    contentCategory: text,
    contentType: text,
    contentIds: MetaStringArray.nullish(),
    contents: z
      .preprocess(value => {
        if (typeof value !== "string") return value;
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }, z.array(z.record(z.unknown())).max(1000))
      .nullish(),
    numItems: number.pipe(z.number().int().nonnegative()).nullish(),
    predictedLtv: number.nullish(),
    status: text,
    searchString: text,
    customData: MetaJsonObject.nullish(),
    appData: MetaJsonObject.nullish(),
    optOut: z.boolean().nullish(),
    ...privacyShape,
  })
  .strict();
export const MetaConversionOptions = z
  .object({
    pixelId: MetaId,
    eventName: z.string().trim().max(256).optional(),
    actionSource: MetaActionSource.default("website"),
    messagingChannel: MetaMessagingChannel.optional(),
    testEventCode: z.string().trim().max(256).optional(),
  })
  .strict();

export function validateMetaReverseSettings(
  options: { stream: string; mode: "upsert" | "mirror"; streamOptions: unknown },
  model: { cursor?: unknown; deleteColumn?: unknown }
) {
  if (options.stream === "audience") {
    const settings = MetaAudienceOptions.parse(options.streamOptions);
    if (settings.audience.kind === "managed" && options.mode !== "mirror")
      throw new Error("Managed Meta audiences require mirror mode");
    if (options.mode === "mirror" && (settings.audience.kind !== "managed" || model.cursor || model.deleteColumn))
      throw new Error(
        "Meta mirror requires a managed audience and a full-query model without a cursor or delete column"
      );
    if (options.mode === "mirror" && !settings.exclusiveManagementConfirmed)
      throw new Error("Confirm exclusive management before mirroring a Meta audience");
  } else if (options.stream === "conversions") {
    MetaConversionOptions.parse(options.streamOptions);
    if (options.mode !== "upsert" || model.deleteColumn)
      throw new Error("Meta conversions require insert mode and a model without a delete column");
  } else throw new Error("Unsupported Meta Reverse ETL stream");
}
