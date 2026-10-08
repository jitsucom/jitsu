import type { BatchResult, JsonObject, ReverseEtlContext, WriteBatch } from "@jitsu/protocols/reverse-etl";
import type {
  DestinationServices,
  ReverseDestinationConfig,
  ReverseRuntimeAdapter,
  ReverseRuntimeRecovery,
} from "@jitsu/protocols/reverse-etl-runtime";
import { contentHash, recordKey } from "../../reverse-etl/identity";
import type { DeliveryDeps } from "./deliver";
import { validateWebhookDestination, webhookRowsStreamMetadata, webhookStreamId } from "./reverse-meta";
import { bindWebhookConfig, createWebhookWriter, invalidDestinationReason, invalidSettingsReason } from "./writer";

type Context = ReverseEtlContext<JsonObject, JsonObject>;

/**
 * After an ambiguous or interrupted delivery the saved batch is re-sent (same records, same idempotency keys) and the
 * result of that re-send is reported, so a record is only called accepted after a 2xx. Records the saved receipt
 * already shows as accepted are not sent again.
 */
export function webhookRecovery(deps?: DeliveryDeps): ReverseRuntimeRecovery {
  return {
    attachWriter: async (ctx: Context) => createWebhookWriter(ctx, deps),
    reconcileBatch: async (
      batch: WriteBatch<JsonObject>,
      action: "upsert" | "remove",
      saved: BatchResult | undefined,
      ctx: Context
    ): Promise<BatchResult> => {
      const accepted = new Set(
        (saved?.outcomes ?? []).filter(outcome => outcome.status === "accepted").map(outcome => outcome.operationId)
      );
      const pending = batch.records.filter(record => !accepted.has(record.operationId));
      const writer = createWebhookWriter(ctx, deps);
      const replayed = pending.length
        ? await (action === "upsert" ? writer.upsert : writer.remove!)({ ...batch, records: pending })
        : { outcomes: [] };
      const byId = new Map(replayed.outcomes.map(outcome => [outcome.operationId, outcome]));
      return {
        outcomes: batch.records.map(
          record => byId.get(record.operationId) ?? { operationId: record.operationId, status: "accepted" as const }
        ),
      };
    },
    reconcileFinish: async () => ({ delivery: "accepted" as const }),
    reconcileInit: async () => "absent" as const,
    reconcileAbort: async () => {},
  };
}

export function createWebhookRuntime(
  config: ReverseDestinationConfig,
  _services?: DestinationServices,
  deps?: DeliveryDeps
): ReverseRuntimeAdapter {
  if (config.options.stream !== webhookStreamId || config.options.mode !== "upsert") {
    throw new Error(invalidSettingsReason);
  }
  const { config: destination, options } = bindWebhookConfig(config.destination, config.options.streamOptions);
  const primaryKey = config.model.primaryKey;
  if (!primaryKey?.length) throw new Error(invalidSettingsReason);
  try {
    validateWebhookDestination(config.destination);
  } catch {
    throw new Error(invalidDestinationReason);
  }

  return {
    options: options as unknown as JsonObject,
    credentials: destination as unknown as JsonObject,
    // The runner hashes this and rejects any run scope string over 512 characters, so the URL goes in as its hash: a
    // long URL (for example one carrying a token in its query string) must not stop the run from starting, and the
    // token never appears in the identity at all.
    targetIdentity: `webhook:POST:${contentHash(destination.url)}`,
    // Identity is the primary key, so an updated row replaces its own entry instead of adding one per change; the
    // payloads stay empty because the row itself is kept in the delivery journal, not in the membership.
    project: (_action, row) => [
      {
        identity: recordKey(primaryKey.map(column => (row as JsonObject)[column] as string | number | boolean)),
        upsert: {},
        remove: {},
      },
    ],
    stream: { ...webhookRowsStreamMetadata, createWriter: async ctx => createWebhookWriter(ctx, deps) } as any,
    recovery: () => webhookRecovery(deps),
  };
}
