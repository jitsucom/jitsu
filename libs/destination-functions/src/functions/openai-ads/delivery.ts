import type { BatchResult, JsonObject, ReverseEtlContext, WriteBatch } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "../../reverse-etl/identity";
import { ReverseEtlManualReconciliationError } from "../../reverse-etl/failure";
import { validateBatchResult } from "../../reverse-etl/meta";
import { safeRejectionDetails } from "../../reverse-etl/rejection-details";
import { OpenAiApiError } from "./client";

export type Context = ReverseEtlContext<JsonObject, JsonObject>;
export const openAiUncertainMessage = "OpenAI delivery results require manual reconciliation; no replay";
export class OpenAiUncertainDelivery extends ReverseEtlManualReconciliationError {
  constructor() {
    super();
    this.message = openAiUncertainMessage;
  }
}
export function batchBinding(ctx: Context, batch: WriteBatch<JsonObject>) {
  return contentHash({
    sync: ctx.syncId,
    run: ctx.logicalRunId,
    target: ctx.targetIdentity,
    revision: ctx.configRevision,
    action: "upsert",
    batchId: batch.batchId,
    records: batch.records,
  });
}
export function accepted(ctx: Context, batch: WriteBatch<JsonObject>): BatchResult {
  return {
    outcomes: batch.records.map(r => ({ operationId: r.operationId, status: "accepted" })),
    /** Only built from a 2xx or an OpenAI error envelope, so the response confirms receipt of the whole batch. */
    submitted: true,
    providerCheckpoint: { binding: batchBinding(ctx, batch) },
  };
}
export function savedReceipt(ctx: Context, batch: WriteBatch<JsonObject>, saved?: BatchResult) {
  if (!saved) return;
  validateBatchResult(batch, saved);
  if (saved.providerCheckpoint?.binding !== batchBinding(ctx, batch) || saved.outcomes.some(r => r.status === "staged"))
    throw new OpenAiUncertainDelivery();
  return saved;
}
/** Shown to users only if it matches the core's code pattern: `http_<status>` or an UPPER_SNAKE enum. */
function rejectionCode(error: OpenAiApiError) {
  return error.code && /^[a-z][a-z0-9_]{0,40}$/.test(error.code)
    ? `OPENAI_${error.code.toUpperCase()}`
    : `http_${error.status}`;
}
export function rejected(ctx: Context, batch: WriteBatch<JsonObject>, error: OpenAiApiError): BatchResult {
  const code = rejectionCode(error);
  const details = safeRejectionDetails(
    error.details.length
      ? error.details.map(d => ({ reason: d.code.toUpperCase(), ...(d.param ? { field: d.param } : {}) }))
      : error.code && error.param
      ? [{ reason: code.toUpperCase(), field: error.param }]
      : []
  );
  return {
    ...accepted(ctx, batch),
    outcomes: batch.records.map(r => ({
      operationId: r.operationId,
      status: "rejected",
      code,
      safeReason: "OpenAI rejected the conversion batch; check the Conversions API key, Pixel ID and event mappings",
      ...(details.length ? { details } : {}),
    })),
  };
}
export function assertContext(ctx: Context, target: string, options: unknown, credentials: unknown) {
  if (
    ctx.targetIdentity !== target ||
    contentHash(ctx.options) !== contentHash(options) ||
    contentHash(ctx.credentials) !== contentHash(credentials)
  )
    throw new Error("OpenAI writer binding does not match the saved target and settings");
}
