import { createHash } from "node:crypto";
import { z } from "zod";
import { MicrosoftAudienceRow, MicrosoftConversionRow } from "./meta";

export const MicrosoftAudienceWire = z.object({ email: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const MicrosoftConversionWire = z
  .object({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    payload: z
      .object({
        ConversionName: z.string().min(1),
        ConversionTime: z.string().datetime(),
        MicrosoftClickId: z.string().optional(),
        HashedEmailAddress: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        HashedPhoneNumber: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        ConversionValue: z.number().finite().optional(),
        ConversionCurrencyCode: z.string().optional(),
        ExternalAttributionCredit: z.number().optional(),
        ExternalAttributionModel: z.string().optional(),
      })
      .strict(),
  })
  .strict();
function invalid(): never {
  throw new Error("Invalid Microsoft Ads row identifiers or conversion fields");
}
function hash(raw: string | null | undefined, hashed: string | null | undefined, phone = false): string | undefined {
  if (raw != null && hashed != null) invalid();
  if (hashed != null) {
    if (!/^[a-f0-9]{64}$/i.test(hashed)) invalid();
    return hashed.toLowerCase();
  }
  if (raw == null) return;
  const value = phone ? raw.trim().replace(/[ ()-]/g, "") : raw.trim().toLowerCase();
  if (phone ? !/^\+[1-9][0-9]{7,14}$/.test(value) : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) invalid();
  return createHash("sha256").update(value).digest("hex");
}
export function normalizeMicrosoftAudience(input: unknown) {
  const row = MicrosoftAudienceRow.parse(input);
  const email = hash(row.email, row.hashedEmail);
  if (!email) invalid();
  return { email };
}
export function projectMicrosoftAudience(_action: "upsert" | "remove", input: unknown) {
  const row = MicrosoftAudienceWire.parse(input);
  return [{ identity: row.email, upsert: row, remove: row }];
}
export function normalizeMicrosoftConversion(input: unknown, name: string, now = Date.now()) {
  const row = MicrosoftConversionRow.parse(input);
  if (!row.__sourceKey) invalid();
  const email = hash(row.email, row.hashedEmail);
  const phone = hash(row.phone, row.hashedPhone, true);
  if (!row.microsoftClickId && !email && !phone) invalid();
  const time = Date.parse(row.conversionTime);
  if (time > now || time < now - 90 * 86400_000) invalid();
  if ((row.externalAttributionCredit != null) !== (row.externalAttributionModel != null)) invalid();
  return {
    key: row.__sourceKey,
    payload: {
      ConversionName: name,
      ConversionTime: new Date(time).toISOString(),
      ...(row.microsoftClickId ? { MicrosoftClickId: row.microsoftClickId.toLowerCase() } : {}),
      ...(email ? { HashedEmailAddress: email } : {}),
      ...(phone ? { HashedPhoneNumber: phone } : {}),
      ...(row.conversionValue != null ? { ConversionValue: row.conversionValue } : {}),
      ...(row.currency != null ? { ConversionCurrencyCode: row.currency.toUpperCase() } : {}),
      ...(row.externalAttributionCredit != null
        ? {
            ExternalAttributionCredit: row.externalAttributionCredit,
            ExternalAttributionModel: row.externalAttributionModel!,
          }
        : {}),
    },
  };
}
