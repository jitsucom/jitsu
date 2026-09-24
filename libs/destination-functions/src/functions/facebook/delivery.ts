import type { BatchResult, JsonObject, ReverseEtlContext, WriteBatch } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "../../reverse-etl/identity";
import { ReverseEtlManualReconciliationError } from "../../reverse-etl/failure";
import { validateBatchResult } from "../../reverse-etl/meta";
import { MetaApiError } from "./client";

export type Context = ReverseEtlContext<JsonObject, JsonObject>;
export type Action = "upsert" | "remove";
export class MetaUncertainDelivery extends ReverseEtlManualReconciliationError {
  constructor() {
    super();
    this.message = "Meta delivery results require manual reconciliation; no replay";
  }
}
export function batchBinding(ctx: Context, batch: WriteBatch<JsonObject>, action: Action) {
  return contentHash({
    sync: ctx.syncId,
    run: ctx.logicalRunId,
    target: ctx.targetIdentity,
    revision: ctx.configRevision,
    action,
    batchId: batch.batchId,
    records: batch.records,
  });
}
export function metaSessionId(ctx: Context, batch: WriteBatch<JsonObject>, action: Action) {
  // 52 bits fit exactly in JSON/JavaScript and Meta's positive signed int64 field.
  return Math.max(1, Number.parseInt(batchBinding(ctx, batch, action).slice(0, 13), 16));
}
export function accepted(ctx: Context, batch: WriteBatch<JsonObject>, action: Action): BatchResult {
  return {
    outcomes: batch.records.map(r => ({ operationId: r.operationId, status: "accepted" })),
    providerCheckpoint: { binding: batchBinding(ctx, batch, action) },
  };
}
export function savedReceipt(ctx: Context, batch: WriteBatch<JsonObject>, action: Action, saved?: BatchResult) {
  if (!saved) return;
  validateBatchResult(batch, saved);
  if (
    saved.providerCheckpoint?.binding !== batchBinding(ctx, batch, action) ||
    saved.outcomes.some(r => r.status === "staged")
  )
    throw new MetaUncertainDelivery();
  return saved;
}
export function rejected(
  ctx: Context,
  batch: WriteBatch<JsonObject>,
  action: Action,
  error: MetaApiError
): BatchResult {
  return {
    ...accepted(ctx, batch, action),
    outcomes: batch.records.map(r => ({
      operationId: r.operationId,
      status: "rejected",
      code: `META_${error.code ?? error.status}`,
      safeReason: `${error.message}; check token permissions, target access and stream mappings`,
    })),
  };
}
export function assertContext(ctx: Context, target: string, options: unknown, credentials: unknown) {
  if (
    ctx.targetIdentity !== target ||
    contentHash(ctx.options) !== contentHash(options) ||
    contentHash(ctx.credentials) !== contentHash(credentials)
  )
    throw new Error("Meta writer binding does not match the saved target and settings");
}
