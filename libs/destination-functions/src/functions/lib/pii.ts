import crypto from "crypto";

// Shared PII normalization/hashing for ad-platform destinations (Facebook CAPI, Google Ads).
// Every one of these APIs wants SHA-256 over a normalized value, hex encoded — the only thing that
// differs is which normalization each vendor mandates, so the hash itself lives here and the
// vendor-specific normalization lives next to the destination that needs it.

/**
 * SHA-256 (hex) of a trimmed, lowercased value. This is the baseline both Facebook and Google
 * specify. Returns undefined for empty input so callers can spread the result without guarding.
 */
export function hashPii(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Strip everything but digits, then drop leading zeros. Used by Facebook, which wants a bare
 * digit string. Google wants E.164 instead — see normalizePhoneE164 in google-ads-destination.ts.
 */
export function sanitizePhone(ph: string) {
  let sanitizedPhone = ph.replace(/[^\d]/g, "");
  sanitizedPhone = sanitizedPhone.replace(/^0+/, "");
  return sanitizedPhone;
}
