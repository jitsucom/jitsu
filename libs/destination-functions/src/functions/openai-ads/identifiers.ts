import { createHash } from "node:crypto";
import { invalidOpenAiConversion } from "./validation-errors";

export const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export type OpenAiIdentifierField = "email" | "phone" | "externalId" | "firstName" | "lastName";

/**
 * Conversions API rules (developers.openai.com/ads/conversions-api). Note the phone rule differs from OpenAI's own
 * audience API, which hashes E.164 including the "+": do not share this function with an audience stream.
 */
export function openAiNormalize(field: OpenAiIdentifierField, value: string): string {
  let normalized: string;
  switch (field) {
    case "email":
      normalized = value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+$/.test(normalized)) invalidOpenAiConversion("identifier");
      break;
    case "phone":
      // Keep the country code; drop whitespace, parentheses, periods and hyphens, then a leading + and leading zeros.
      normalized = value
        .replace(/[\s().-]/g, "")
        .replace(/^\+/, "")
        .replace(/^0+/, "");
      if (!/^[1-9][0-9]{7,14}$/.test(normalized)) invalidOpenAiConversion("identifier");
      break;
    case "externalId":
      normalized = value.trim();
      break;
    case "firstName":
    case "lastName":
      // Lowercase, then drop whitespace and ASCII punctuation. Non-ASCII letters keep their accents.
      normalized = value.toLowerCase().replace(/[\s!-/:-@[-`{-~]/g, "");
      break;
  }
  if (!normalized) invalidOpenAiConversion("identifier");
  return normalized;
}

const has = (value: unknown) => value !== undefined && value !== null && value !== "";

/** Raw column or a pre-hashed column, never both. Hashing happens here once; saved payloads are never re-hashed. */
export function openAiHashes(row: Record<string, unknown>, raw: OpenAiIdentifierField, hashed: string): string[] {
  if (has(row[raw]) && has(row[hashed])) invalidOpenAiConversion("identifier");
  const value = has(row[hashed]) ? row[hashed] : row[raw];
  if (!has(value)) return [];
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values.filter(has).map(v => {
        if (typeof v !== "string") invalidOpenAiConversion("identifier");
        if (has(row[hashed])) {
          if (!/^[a-fA-F0-9]{64}$/.test(v.trim())) invalidOpenAiConversion("identifier");
          return v.trim().toLowerCase();
        }
        return digest(openAiNormalize(raw, v));
      })
    ),
  ].sort();
}
