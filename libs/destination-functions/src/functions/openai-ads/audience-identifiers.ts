import { digest } from "./identifiers";
import { invalidOpenAiAudience } from "./validation-errors";

/** Identifier types OpenAI's custom audience API accepts that Jitsu sends. `email` and `phone` are hashed here first. */
export type OpenAiAudienceIdentifierType = "email_sha256" | "phone_number_sha256" | "gaid";
export type OpenAiAudienceIdentifier = { identifier_type: OpenAiAudienceIdentifierType; identifier: string };

const has = (value: unknown) => value !== undefined && value !== null && value !== "";
const sha256 = /^[a-fA-F0-9]{64}$/;
const gaid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Audience API rules (developers.openai.com/ads/custom-audiences): the email is trimmed and lowercased with dots and
 * plus tags kept; the phone is E.164 INCLUDING the "+". Conversions hash the phone without it, so this is a separate
 * function from `openAiNormalize`.
 */
export function openAiAudienceEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) invalidOpenAiAudience("identifier");
  return email;
}
export function openAiAudiencePhone(value: string): string {
  // Drop whitespace, parentheses, periods and hyphens, accept a leading "00" as "+", and require the country code.
  const digits = value.replace(/[\s().-]/g, "").replace(/^00/, "+");
  const phone = digits.startsWith("+") ? digits : `+${digits}`;
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) invalidOpenAiAudience("identifier");
  return phone;
}
/** A raw, nonzero, hyphenated UUID. OpenAI hashes it itself and forbids pre-hashing. */
export function openAiAudienceGaid(value: string): string {
  const id = value.trim().toLowerCase();
  if (!gaid.test(id) || id === "00000000-0000-0000-0000-000000000000") invalidOpenAiAudience("identifier");
  return id;
}

function oneHash(row: Record<string, unknown>, raw: string, hashed: string, normalize: (v: string) => string) {
  // A raw column or a pre-hashed column, never both. Hashing happens once, here; saved payloads are never re-hashed.
  if (has(row[raw]) && has(row[hashed])) invalidOpenAiAudience("identifier");
  if (has(row[hashed])) {
    const value = row[hashed];
    if (typeof value !== "string" || !sha256.test(value.trim())) invalidOpenAiAudience("identifier");
    return value.trim().toLowerCase();
  }
  if (!has(row[raw])) return undefined;
  if (typeof row[raw] !== "string") invalidOpenAiAudience("identifier");
  return digest(normalize(row[raw] as string));
}

/**
 * The identifiers for one source row, always in the same order (email, phone, GAID) so the same row yields the same
 * request bytes, which the idempotency key depends on. One value per type: a person with several emails needs them
 * combined in SQL.
 */
export function openAiAudienceIdentifiers(row: Record<string, unknown>): OpenAiAudienceIdentifier[] {
  const result: OpenAiAudienceIdentifier[] = [];
  const email = oneHash(row, "email", "hashedEmail", openAiAudienceEmail);
  if (email) result.push({ identifier_type: "email_sha256", identifier: email });
  const phone = oneHash(row, "phone", "hashedPhone", openAiAudiencePhone);
  if (phone) result.push({ identifier_type: "phone_number_sha256", identifier: phone });
  if (has(row.gaid)) {
    if (typeof row.gaid !== "string") invalidOpenAiAudience("identifier");
    result.push({ identifier_type: "gaid", identifier: openAiAudienceGaid(row.gaid) });
  }
  if (!result.length) invalidOpenAiAudience("noIdentifier");
  return result;
}
