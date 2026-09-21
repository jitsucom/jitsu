// Browser-safe schemas shared by stream settings, runner admission and mapping editors.
import { z } from "zod";
import { GoogleContactFields, GoogleAudienceCredentials } from "./meta";

export const googleConversionStreams = ["click-conversions", "call-conversions", "conversion-adjustments"] as const;
export type GoogleConversionStream = (typeof googleConversionStreams)[number];
export const GoogleConversionStream = z.enum(googleConversionStreams);
export const GoogleConversionCredentials = GoogleAudienceCredentials.extend({ developerToken: z.string().optional() });
export const GoogleConversionOptions = z
  .object({
    conversionActionId: z.string().regex(/^[1-9]\d{0,19}$/),
    api: z.enum(["data-manager", "google-ads"]).optional(),
    adjustmentType: z.enum(["ENHANCEMENT", "RESTATEMENT", "RETRACTION"]).optional(),
    dataSource: z.enum(["FIRST_PARTY", "THIRD_PARTY"]).optional(),
  })
  .strict();
const text = z.string().max(4096).nullish();
const number = z.number().finite().nullish();
const time = z.union([z.string(), z.date()]).transform(value => (value instanceof Date ? value.toISOString() : value));
const consent = z.enum(["GRANTED", "DENIED", "UNSPECIFIED", "UNKNOWN"]).nullish();
const json = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(value => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, schema.nullish());
const common = {
  // Injected from the model primary key by core, never configured by the user.
  __sourceKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  conversionTimestamp: time,
  value: number,
  currency: text,
  adUserData: consent,
  adPersonalization: consent,
  customVariables: json(z.record(z.union([z.string(), z.number(), z.boolean()]))),
};
export const GoogleClickRow = z
  .object({
    ...common,
    ...GoogleContactFields,
    gclid: text,
    gbraid: text,
    wbraid: text,
    orderId: text,
    userIpAddress: text,
    userAgent: text,
    conversionEnvironment: z.enum(["APP", "WEB", "IN_STORE", "PHONE", "MESSAGE", "OTHER", "UNSPECIFIED"]).nullish(),
    sessionAttributesEncoded: text,
    sessionAttributes: json(
      z
        .object({
          gadSource: text,
          gadCampaignId: text,
          landingPageUrl: text,
          sessionStartTime: text,
          landingPageReferrer: text,
          landingPageUserAgent: text,
        })
        .strict()
    ),
    merchantId: text,
    merchantCountryCode: text,
    merchantLanguageCode: text,
    transactionDiscount: number,
    items: json(
      z
        .array(z.object({ productId: z.string(), quantity: z.number().finite(), price: z.number().finite() }).strict())
        .max(1000)
    ),
  })
  .strict();
export const GoogleCallRow = z.object({ ...common, callerId: z.string().min(1), callTimestamp: time }).strict();
export const GoogleAdjustmentRow = z
  .object({
    __sourceKey: common.__sourceKey,
    ...GoogleContactFields,
    adjustmentType: z.enum(["ENHANCEMENT", "RESTATEMENT", "RETRACTION"]).nullish(),
    adjustmentTimestamp: time.nullish(),
    conversionTimestamp: time.nullish(),
    orderId: text,
    gclid: text,
    restatementValue: number,
    restatementCurrency: text,
    streetAddress: text,
    hashedStreetAddress: text,
    city: text,
    state: text,
    userAgent: text,
  })
  .strict();
export const googleConversionRows = {
  "click-conversions": GoogleClickRow,
  "call-conversions": GoogleCallRow,
  "conversion-adjustments": GoogleAdjustmentRow,
};
export const googleConversionLabels = {
  "click-conversions": "Click / offline conversions",
  "call-conversions": "Phone-call conversions",
  "conversion-adjustments": "Conversion adjustments",
};
