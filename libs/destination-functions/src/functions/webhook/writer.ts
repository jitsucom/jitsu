import type {
  BatchResult,
  JsonObject,
  ReverseEtlContext,
  ReverseEtlWriter,
  WriteBatch,
} from "@jitsu/protocols/reverse-etl";
import { GuardedRequestError } from "../lib/guarded-request";
import {
  defaultDeliveryDeps,
  deliverBatch,
  type DeliveryAction,
  type DeliveryDeps,
  type DeliveryRecord,
} from "./deliver";
import {
  parseWebhookUrl,
  validateWebhookDestination,
  WebhookRowsOptions,
  type WebhookCredentials,
} from "./reverse-meta";

export const invalidDestinationReason = "Webhook destination configuration is invalid";
export const invalidSettingsReason = "Webhook sync settings are invalid";

/** Re-checks the bound configuration. A failure here is a clean init failure, before any request is sent. */
export function bindWebhookConfig(
  credentials: unknown,
  options: unknown
): { config: WebhookCredentials; options: WebhookRowsOptions } {
  let config: WebhookCredentials;
  try {
    config = validateWebhookDestination(credentials as Record<string, unknown>);
  } catch {
    throw new Error(invalidDestinationReason);
  }
  const parsed = WebhookRowsOptions.safeParse(options);
  if (!parsed.success) throw new Error(invalidSettingsReason);
  // The save-time check (validateWebhookReverseSettings) is repeated here, because this is what runs on every delivery:
  // a saved configuration changed behind the console's back must not send rows over plain http without the acknowledgement.
  if (parseWebhookUrl(config.url).protocol === "http:" && parsed.data.allowInsecureHttp !== true) {
    throw new Error(invalidSettingsReason);
  }
  return { config, options: parsed.data };
}

/**
 * Writer for the webhook stream. `upsert` and `remove` never throw for anything they can classify: every failure becomes
 * a rejected outcome with a stable code, because a thrown error would leave the batch "unknown" and block the sync.
 * Only an abort propagates.
 */
export function createWebhookWriter(
  ctx: ReverseEtlContext<JsonObject, JsonObject>,
  deps: DeliveryDeps = defaultDeliveryDeps
): ReverseEtlWriter<JsonObject> {
  const { config, options } = bindWebhookConfig(ctx.credentials, ctx.options);
  const scope = { syncId: ctx.syncId, runId: ctx.logicalRunId };

  async function send(batch: WriteBatch<JsonObject>, action: DeliveryAction): Promise<BatchResult> {
    const records: DeliveryRecord[] = batch.records.map(record => ({
      operationId: record.operationId,
      key: record.key,
      row: record.row,
    }));
    try {
      return { outcomes: await deliverBatch({ records, action, scope, config, options, signal: ctx.signal, deps }) };
    } catch (error) {
      if (ctx.signal.aborted || (error instanceof GuardedRequestError && error.code === "aborted")) throw error;
      return {
        outcomes: records.map(record => ({
          operationId: record.operationId,
          status: "rejected" as const,
          code: "internal_error",
          safeReason: "Unexpected delivery error",
        })),
      };
    }
  }

  return {
    init: async () => {},
    upsert: batch => send(batch, "upsert"),
    remove: batch => send(batch, "delete"),
    finish: async () => ({ delivery: "accepted" as const }),
    abort: async () => {},
  };
}
