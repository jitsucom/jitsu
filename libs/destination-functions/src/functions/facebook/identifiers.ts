import { createHash } from "node:crypto";
import { metaContactFields } from "./reverse-meta";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function metaInvalid(): never {
  throw new Error("Invalid Meta row mapping or identifier");
}
export function metaNormalize(field: string, value: string): string {
  let normalized = value.trim().toLowerCase();
  switch (field) {
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) metaInvalid();
      break;
    case "phone":
      normalized = normalized.replace(/[^0-9]/g, "").replace(/^0+/, "");
      if (!/^[1-9][0-9]{6,14}$/.test(normalized)) metaInvalid();
      break;
    case "firstName":
    case "lastName":
    case "firstInitial":
      normalized = normalized.replace(/[^\p{L}\p{M}]/gu, "");
      if (field === "firstInitial") normalized = [...normalized][0] ?? "";
      break;
    case "city":
    case "state":
      normalized = normalized.replace(/[^a-z]/g, "");
      break;
    case "postalCode":
      normalized = /^\d{5}(-\d{4})?$/.test(normalized) ? normalized.slice(0, 5) : normalized.replace(/[\s-]/g, "");
      break;
    case "country":
      if (!/^[a-z]{2}$/.test(normalized)) metaInvalid();
      break;
    case "gender":
      normalized = normalized === "male" ? "m" : normalized === "female" ? "f" : normalized;
      if (normalized !== "m" && normalized !== "f") metaInvalid();
      break;
    case "birthYear":
      if (!/^\d{4}$/.test(normalized) || Number(normalized) < 1900 || Number(normalized) > 2100) metaInvalid();
      break;
    case "birthMonth":
    case "birthDay":
      if (
        !/^\d{1,2}$/.test(normalized) ||
        Number(normalized) < 1 ||
        Number(normalized) > (field === "birthMonth" ? 12 : 31)
      )
        metaInvalid();
      normalized = normalized.padStart(2, "0");
      break;
    case "dateOfBirth": {
      normalized = normalized.replace(/[-/]/g, "");
      if (!/^\d{8}$/.test(normalized)) metaInvalid();
      const iso = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
      if (!Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso) metaInvalid();
      break;
    }
    case "externalId":
      return value; // Preserve the advertiser's exact external-ID convention.
  }
  if (!normalized) metaInvalid();
  return normalized;
}
export function metaHashes(row: Record<string, unknown>, raw: string, hashed: string): string[] {
  const has = (value: unknown) => value !== undefined && value !== null && value !== "";
  if (has(row[raw]) && has(row[hashed])) metaInvalid();
  const value = has(row[hashed]) ? row[hashed] : row[raw];
  if (!has(value)) return [];
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values.map(v => {
        if (typeof v !== "string" || !v.trim()) metaInvalid();
        if (has(row[hashed])) {
          if (!/^[a-fA-F0-9]{64}$/.test(v.trim())) metaInvalid();
          return v.trim().toLowerCase();
        }
        return digest(metaNormalize(raw, v));
      })
    ),
  ].sort();
}
export function metaUserData(row: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [raw, hashed, , , field] of metaContactFields) {
    const values = metaHashes(row, raw, hashed);
    if (values.length) data[field] = values;
  }
  for (const [raw, hashed, field] of [
    ["externalId", "hashedExternalId", "external_id"],
    ["dateOfBirth", "hashedDateOfBirth", "db"],
  ]) {
    const values = metaHashes(row, raw, hashed);
    if (values.length) data[field] = values;
  }
  for (const [source, field] of [
    ["clientIpAddress", "client_ip_address"],
    ["clientUserAgent", "client_user_agent"],
    ["fbc", "fbc"],
    ["fbp", "fbp"],
    ["subscriptionId", "subscription_id"],
    ["facebookLoginId", "fb_login_id"],
    ["leadId", "lead_id"],
    ["mobileAdvertisingId", "madid"],
    ["anonymousId", "anon_id"],
    ["pageId", "page_id"],
    ["pageScopedUserId", "page_scoped_user_id"],
    ["ctwaClid", "ctwa_clid"],
    ["whatsappBusinessAccountId", "whatsapp_business_account_id"],
    ["instagramAccountId", "instagram_business_account_id"],
    ["instagramScopedId", "ig_sid"],
  ])
    if (row[source] !== undefined && row[source] !== null && row[source] !== "") data[field] = row[source];
  return data;
}
