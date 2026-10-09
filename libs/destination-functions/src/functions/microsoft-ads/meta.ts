import { z } from "zod";

export const microsoftOAuthIntegration = "jitsu-cloud-dst-microsoft-ads";
export const microsoftAudienceState = "__jitsu_microsoft_audience_v1";
// Microsoft uses int64 IDs. Keep strings throughout; never round them via Number.
export const MicrosoftId = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine(v => BigInt(v) <= 9223372036854775807n);
export const MicrosoftAdsCredentials = z.object({
  customerId: MicrosoftId.describe("Customer ID::Manager/customer ID, not your account number."),
  accountId: MicrosoftId.describe("Account ID::Numeric advertising account ID, not the alphanumeric account number."),
  developerToken: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .optional()
    .describe("Developer token::Optional when configured by your Jitsu administrator."),
  authorized: z.boolean().optional(),
  oauthIntegrationId: z.literal(microsoftOAuthIntegration).optional(),
  oauthConnectionId: z.string().min(1).max(256).optional(),
});
export const MicrosoftRuntimeCredentials = MicrosoftAdsCredentials.extend({
  oauthIntegrationId: z.literal(microsoftOAuthIntegration),
  oauthConnectionId: z.string().min(1).max(256),
});
export const MicrosoftAdsCredentialsUi = {
  authorized: { hidden: true },
  oauthIntegrationId: { hidden: true },
  oauthConnectionId: { hidden: true },
  developerToken: { password: true },
};
export const MicrosoftAudienceOptions = z
  .object({
    audience: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("managed"), name: z.string().trim().min(1).max(128) }).strict(),
      z.object({ kind: z.literal("existing"), audienceId: MicrosoftId }).strict(),
    ]),
    acceptCustomerMatchTerms: z.boolean().default(false),
    exclusiveManagementConfirmed: z.boolean().default(false),
  })
  .strict();
export const MicrosoftConversionOptions = z
  .object({
    conversionName: z.string().trim().min(1).max(100),
  })
  .strict();
const optionalIdentifier = z.string().min(1).max(1024).nullish();
export const MicrosoftAudienceRow = z.object({ email: optionalIdentifier, hashedEmail: optionalIdentifier }).strict();
export const MicrosoftConversionRow = z
  .object({
    __sourceKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    conversionTime: z.string().datetime({ offset: true }),
    microsoftClickId: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{32}$/i)
      .nullish(),
    email: optionalIdentifier,
    hashedEmail: optionalIdentifier,
    phone: optionalIdentifier,
    hashedPhone: optionalIdentifier,
    conversionValue: z.number().finite().nullish(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .nullish(),
    externalAttributionCredit: z.number().positive().max(1).nullish(),
    externalAttributionModel: z.string().min(1).max(100).nullish(),
  })
  .strict();

export function validateMicrosoftSettings(
  options: { stream: string; mode: string; streamOptions: unknown; mapping: Record<string, string> },
  model: { cursor?: unknown; deleteColumn?: unknown },
  destination?: Record<string, unknown>
) {
  if (destination && !MicrosoftRuntimeCredentials.safeParse(destination).success)
    throw new Error("Connect this Microsoft Ads destination with OAuth and configure its customer/account IDs.");
  const fields = Object.keys(options.mapping);
  if (options.stream === "audience") {
    const parsed = MicrosoftAudienceOptions.safeParse(options.streamOptions);
    if (!parsed.success) throw new Error("Configure a Microsoft audience ID or a new audience name.");
    if (fields.some(f => !["email", "hashedEmail"].includes(f)) || fields.length !== 1)
      throw new Error("Map exactly one email column: raw or SHA-256.");
    if (parsed.data.audience.kind === "managed") {
      if (options.mode !== "mirror" || model.cursor || model.deleteColumn || !parsed.data.exclusiveManagementConfirmed)
        throw new Error(
          "Managed Microsoft audiences require a full-model mirror and exclusive management confirmation."
        );
    } else if (options.mode !== "upsert")
      throw new Error("Existing Microsoft audiences support additions and explicit removals, not mirror.");
  } else if (options.stream === "offline-conversions") {
    if (!MicrosoftConversionOptions.safeParse(options.streamOptions).success)
      throw new Error("Configure the existing Microsoft offline conversion goal name.");
    if (options.mode !== "upsert" || model.deleteColumn)
      throw new Error("Microsoft offline conversions are insert-only; mirror and delete columns are unsupported.");
    if (
      !options.mapping.conversionTime ||
      !["microsoftClickId", "email", "hashedEmail", "phone", "hashedPhone"].some(f => options.mapping[f])
    )
      throw new Error("Map conversion time and at least one click ID, email or phone identifier.");
    if (fields.some(f => f === "__sourceKey" || !Object.hasOwn(MicrosoftConversionRow.shape, f)))
      throw new Error("Unknown Microsoft conversion mapping field.");
    if (
      (options.mapping.email && options.mapping.hashedEmail) ||
      (options.mapping.phone && options.mapping.hashedPhone)
    )
      throw new Error("Choose raw or SHA-256 for each identifier, not both.");
  } else throw new Error("Unsupported Microsoft Ads stream.");
}
