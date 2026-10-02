import { createHash } from "node:crypto";
import { z } from "zod";
import { ReverseEtlProtocolError } from "../../../reverse-etl/meta";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const fail = (message: string): never => {
  throw new ReverseEtlProtocolError(message);
};
export const values = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter(v => v !== null && v !== undefined && v !== "")
    .map(v => {
      if (typeof v !== "string") return fail("Google identifiers must be strings or arrays of strings");
      return v;
    });
export const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const addressSchema = z
  .object({
    givenName: hex,
    familyName: hex,
    regionCode: z.string().regex(/^[A-Z]{2}$/),
    postalCode: z.string().min(1),
  })
  .strict();
export const userIdentifierSchema = z.union([
  z.object({ emailAddress: hex }).strict(),
  z.object({ phoneNumber: hex }).strict(),
  z.object({ address: addressSchema }).strict(),
]);
export function email(value: string) {
  const parts = value.toLowerCase().replace(/\s/g, "").split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1].includes(".")) return fail("Invalid Google email identifier");
  // Preserve the existing audience normalization and identity keys.
  if (["gmail.com", "googlemail.com"].includes(parts[1])) parts[0] = parts[0].split("+")[0].replace(/\./g, "");
  if (!parts[0]) return fail("Invalid Google email identifier");
  return digest(parts.join("@"));
}
export function normalizePhone(value: string, countryCode?: string) {
  let normalized = value.replace(/[\s().-]/g, "");
  if (!normalized.startsWith("+") && countryCode) normalized = `+${countryCode.replace(/^\+/, "")}${normalized}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return fail("Google phone requires E.164 or a phone country code");
  return normalized;
}
// Google's formatting guide preserves punctuation (for example, smith-jones).
export const nameHash = (value: string) => digest(value.trim().toLowerCase());
/** Shared by audience and conversion mappings. Raw PII never reaches durable provider payloads. */
export function contactIdentifiers(row: Record<string, any>) {
  const result: z.infer<typeof userIdentifierSchema>[] = [];
  for (const [raw, hashed, wire, normalize] of [
    ["email", "hashedEmail", "emailAddress", email],
    ["phone", "hashedPhone", "phoneNumber", (v: string) => digest(normalizePhone(v, row.phoneCountryCode))],
  ] as const) {
    if (values(row[raw]).length && values(row[hashed]).length) fail("Choose raw or SHA-256 for each identifier");
    for (const v of values(row[raw])) result.push({ [wire]: normalize(v) } as any);
    for (const v of values(row[hashed])) result.push({ [wire]: hex.parse(v.toLowerCase()) } as any);
  }
  const first = row.firstName || row.hashedFirstName;
  const last = row.lastName || row.hashedLastName;
  if (first || last || row.countryCode || row.postalCode) {
    if (!first || !last || !row.countryCode || !row.postalCode)
      fail("Address matching requires first name, last name, country code and postal code");
    if ((row.firstName && row.hashedFirstName) || (row.lastName && row.hashedLastName))
      fail("Choose raw or SHA-256 for each name");
    result.push({
      address: addressSchema.parse({
        givenName: row.firstName ? nameHash(row.firstName) : row.hashedFirstName.toLowerCase(),
        familyName: row.lastName ? nameHash(row.lastName) : row.hashedLastName.toLowerCase(),
        regionCode: row.countryCode.trim().toUpperCase(),
        postalCode: row.postalCode.trim(),
      }),
    });
  }
  return [...new Map(result.map(id => [JSON.stringify(id), id])).values()];
}
