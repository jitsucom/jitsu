// Browser-safe: types and Zod only. Do not import Node modules, the signing helper or the request code here.
import { z } from "zod";
import type { JsonObject, ReverseEtlStreamMetadata } from "@jitsu/protocols/reverse-etl";

export const webhookStreamId = "rows";
export const webhookDestinationType = "webhook";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Converts a warehouse value to plain JSON, deterministically and recursively. The run validates each mapped row against
 * the stream's row type and then hashes it, and anything that is not plain JSON fails the whole run, so these are
 * converted here: binary to base64, a Postgres interval to an ISO 8601 duration, NaN/Infinity to strings, dates to ISO
 * strings, bigint to a string, undefined to null.
 */
export function normalizeRowValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    return Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity";
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    return typeof Buffer !== "undefined"
      ? Buffer.from(value).toString("base64")
      : btoa(String.fromCharCode(...Array.from(value)));
  }
  if (Array.isArray(value)) return value.map(normalizeRowValue);
  if (typeof value === "object") {
    const object = value as { constructor?: { name?: string }; toISOString?: () => string };
    if (object.constructor?.name === "PostgresInterval" && typeof object.toISOString === "function") {
      return object.toISOString();
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeRowValue(item)]));
  }
  return String(value);
}

const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValue), z.record(jsonValue)])
);
export const WebhookRow = z.preprocess(normalizeRowValue, z.record(jsonValue)) as unknown as z.ZodType<JsonObject>;

export const WebhookRowsOptions = z
  .object({
    recordsPerRequest: z.number().int().min(1).max(200).default(50),
    concurrency: z.number().int().min(1).max(10).default(2),
    /** Delivery is at-least-once; the user confirms the endpoint tolerates repeated records. */
    deliveryAttested: z.literal(true),
    /** Required, and only meaningful, when the destination URL is http://. */
    allowInsecureHttp: z.boolean().optional(),
  })
  .strict();
export type WebhookRowsOptions = z.infer<typeof WebhookRowsOptions>;

/** The saved Webhook destination; unknown keys (name, id, connection fields) are tolerated. */
export const WebhookCredentials = z
  .object({
    url: z.string(),
    method: z.string().default("POST"),
    headers: z.array(z.string()).optional(),
    signatureMethod: z.enum(["none", "hmac", "ed25519"]).optional().default("none"),
    signatureSecret: z.string().optional(),
    signaturePrivateKey: z.string().optional(),
    signatureHeader: z.string().optional().default("Jitsu-Signature"),
    signatureIncludeTimestamp: z.boolean().optional().default(true),
  })
  .passthrough();
export type WebhookCredentials = z.infer<typeof WebhookCredentials>;

export const webhookRowsStreamMetadata: ReverseEtlStreamMetadata<JsonObject, WebhookRowsOptions> = {
  name: webhookStreamId,
  displayName: "Rows",
  rowType: WebhookRow,
  removeRowType: WebhookRow,
  options: WebhookRowsOptions as unknown as z.ZodType<WebhookRowsOptions>,
  batchSize: 200,
  // Replay re-sends the same records with the same idempotency keys; the user attests the endpoint tolerates it.
  capabilities: { supportsUpsert: true, supportsExplicitRemove: true, mirror: "none", replay: "idempotency-key" },
};

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const reservedHeaders = new Set([
  "host",
  "content-length",
  "content-type",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "user-agent",
  "idempotency-key",
]);
const maxHeaders = 20;

export class WebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookConfigError";
  }
}

/** "Name: value" lines to name/value pairs. Splits at the first colon only, so values may contain colons. */
export function parseWebhookHeaders(lines: string[] | undefined): Array<{ name: string; value: string }> {
  const result: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();
  for (const line of lines ?? []) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon < 1) throw new WebhookConfigError(`Header "${line.slice(0, 40)}" must look like "Name: value"`);
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    const lower = name.toLowerCase();
    if (!headerName.test(name)) throw new WebhookConfigError(`"${name.slice(0, 40)}" is not a valid header name`);
    if (/[\r\n\0]/.test(value)) throw new WebhookConfigError(`The value of header ${name} contains a line break`);
    if (reservedHeaders.has(lower) || lower.startsWith("jitsu-")) {
      throw new WebhookConfigError(`Header ${name} is set by Jitsu and cannot be overridden`);
    }
    if (seen.has(lower)) throw new WebhookConfigError(`Header ${name} is listed more than once`);
    seen.add(lower);
    result.push({ name, value });
  }
  if (result.length > maxHeaders) throw new WebhookConfigError(`At most ${maxHeaders} headers are supported`);
  return result;
}

export function parseWebhookUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebhookConfigError("The webhook URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebhookConfigError("The webhook URL must start with http:// or https://");
  }
  if (url.username || url.password) {
    throw new WebhookConfigError("The webhook URL must not contain a username or password");
  }
  return url;
}

/** Checks the saved destination for use by a reverse sync. Throws WebhookConfigError with a readable message. */
export function validateWebhookDestination(destination: Record<string, unknown>): WebhookCredentials {
  const config = WebhookCredentials.parse(destination);
  if (config.method.toUpperCase() !== "POST") {
    throw new WebhookConfigError(
      `Reverse ETL sends POST requests; the destination method is ${config.method}. Set it to POST.`
    );
  }
  parseWebhookUrl(config.url);
  parseWebhookHeaders(config.headers);
  if (config.signatureMethod === "hmac" && !config.signatureSecret) {
    throw new WebhookConfigError("Request signing is HMAC but no signing secret is set");
  }
  if (config.signatureMethod === "ed25519" && !config.signaturePrivateKey) {
    throw new WebhookConfigError("Request signing is Ed25519 but no private key is set");
  }
  if (!headerName.test(config.signatureHeader)) {
    throw new WebhookConfigError("The signature header name is not a valid header name");
  }
  return config;
}

export const webhookFieldName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const webhookMaxFields = 200;

/** Mapping is the identity over the model's columns; every primary-key column must be present. */
export function validateWebhookMapping(mapping: Record<string, string>, primaryKey: string[] | undefined) {
  const fields = Object.entries(mapping);
  if (!fields.length) throw new WebhookConfigError("The model has no columns to send");
  if (fields.length > webhookMaxFields) {
    throw new WebhookConfigError(`At most ${webhookMaxFields} columns can be sent; select fewer columns in the model`);
  }
  for (const [field, column] of fields) {
    if (field !== column)
      throw new WebhookConfigError("Columns are sent under their own names; rename them in the model SQL");
    if (!webhookFieldName.test(field)) {
      throw new WebhookConfigError(
        `Column "${field.slice(
          0,
          40
        )}" cannot be sent as a field name: use letters, digits and underscores, starting with a letter or underscore. Rename it in the model SQL`
      );
    }
  }
  for (const column of primaryKey ?? []) {
    if (mapping[column] !== column) {
      throw new WebhookConfigError(`The primary key column ${column} must be part of the model's selected columns`);
    }
  }
}

/** Save-time validation for a webhook reverse sync (the catalog's `validateSettings`). */
export function validateWebhookReverseSettings(
  options: { stream: string; mode: "upsert" | "mirror"; streamOptions: unknown; mapping: Record<string, string> },
  model: { cursor?: unknown; deleteColumn?: unknown; primaryKey?: string[] },
  destination: Record<string, unknown>
) {
  if (options.stream !== webhookStreamId) throw new WebhookConfigError("This webhook stream is not supported");
  if (options.mode !== "upsert")
    throw new WebhookConfigError("Webhook syncs send changes (upsert mode); mirror mode is not supported");
  const streamOptions = WebhookRowsOptions.parse(options.streamOptions);
  const config = validateWebhookDestination(destination);
  if (parseWebhookUrl(config.url).protocol === "http:" && streamOptions.allowInsecureHttp !== true) {
    throw new WebhookConfigError(
      "This URL uses http://, which sends data and any credentials unencrypted. Use https://, or confirm that you accept unencrypted HTTP"
    );
  }
  validateWebhookMapping(options.mapping, model.primaryKey);
}
