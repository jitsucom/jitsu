import { z } from "zod";
import type { JsonObject, ReverseEtlStream, WriteBatch } from "@jitsu/protocols/reverse-etl";
import type { DestinationServices, ReverseRuntimeAdapter } from "@jitsu/protocols/reverse-etl-runtime";
import { OpenAiAdsCall, OpenAiWait, realWait } from "./ads-client";
import { OpenAiAudienceIdentifier, openAiAudienceIdentifiers } from "./audience-identifiers";
import { submitMembership, waitForOperation } from "./audience-api";
import type { ResolvedOpenAiAudience } from "./audience-provisioning";
import { OpenAiApiError, openAiLog } from "./client";
import {
  Action,
  Context,
  accepted,
  assertContext,
  batchBinding,
  rejected,
  rejectedOperation,
  savedReceipt,
} from "./delivery";
import { OpenAiAudienceOptions, OpenAiAudienceRow } from "./reverse-meta";

const identifier = z
  .object({
    identifier_type: z.enum(["email_sha256", "phone_number_sha256", "gaid"]),
    identifier: z.string().min(1).max(128),
  })
  .strict();
/**
 * One member as the core stores it: every identifier we send, and the `identity` the core compares across runs. The
 * identity is a single identifier (email, else phone, else GAID). Add and Remove both send every identifier: OpenAI
 * treats each as a matching candidate, so a Remove with only the identity could leave a person matched by another one.
 */
export const openAiAudienceWire = z
  .object({ identifiers: z.array(identifier).min(1).max(3), identity: z.record(z.string()) })
  .strict();

/** At most 3 identifiers per member, so 3,000 members stay within OpenAI's 10,000-identifier small-update path. */
const batchSize = 3000;

export function normalizeOpenAiAudience(input: unknown): JsonObject {
  const identifiers = openAiAudienceIdentifiers(OpenAiAudienceRow.parse(input) as Record<string, unknown>);
  const key = identifiers[0];
  return { identifiers, identity: { [key.identifier_type]: key.identifier } };
}
export function projectOpenAiAudience(_action: Action, input: unknown) {
  const row = openAiAudienceWire.parse(input);
  return [{ identity: row.identity, upsert: row as JsonObject, remove: row as JsonObject }];
}

export function createOpenAiAudience(
  credentials: JsonObject,
  options: JsonObject,
  resolved: ResolvedOpenAiAudience,
  services: DestinationServices,
  wait: OpenAiWait = realWait
): ReverseRuntimeAdapter {
  OpenAiAudienceOptions.parse(options);
  const { audienceId, accountId, managed } = resolved;
  const targetIdentity = `openai-audience:${accountId}:${audienceId}`;
  const apiKey = String(credentials.adsApiKey);
  const log = (message: string) => openAiLog(services.log, message);
  const callFor = (ctx: Context): OpenAiAdsCall => ({
    fetch: ctx.fetch as OpenAiAdsCall["fetch"],
    apiKey,
    signal: ctx.signal,
  });

  /**
   * Sends one batch and waits for OpenAI to finish it. The idempotency key comes from the batch binding, so the same
   * batch always carries the same key and a replay returns the original operation, whether it was lost, still running
   * or finished. A wait that runs out or a lost response throws: the core then marks the batch unknown and recovery
   * replays it, never a new key.
   */
  async function apply(
    ctx: Context,
    batch: WriteBatch<JsonObject>,
    action: Action
  ): Promise<ReturnType<typeof accepted>> {
    const identifiers = batch.records.flatMap(
      r => openAiAudienceWire.parse(r.row).identifiers as OpenAiAudienceIdentifier[]
    );
    const key = `jitsu-${batchBinding(ctx, batch, action)}`;
    const call = callFor(ctx);
    // Only a refused submit proves nothing was applied. Once OpenAI has returned an operation, an error while waiting
    // for it (a 401, 403 or 404 after access was revoked, say) says nothing about the operation: it throws, the core
    // marks the batch unknown, and recovery replays the same key.
    let operation;
    try {
      operation = await submitMembership(call, audienceId, action === "remove" ? "remove" : "add", identifiers, key, {
        wait,
      });
    } catch (error) {
      if (error instanceof OpenAiApiError) {
        await log(`${error.message}; audience request ${error.rejected ? "rejected" : "unconfirmed"}.`);
        if (error.rejected) return rejected(ctx, batch, error, action, "audience");
      }
      throw error;
    }
    let done;
    try {
      done = await waitForOperation(call, audienceId, operation.operation_id, { wait });
    } catch (error) {
      if (error instanceof OpenAiApiError) await log(`${error.message}; audience request unconfirmed.`);
      throw error;
    }
    if (done.status === "succeeded") {
      await log(
        `OpenAI applied ${batch.records.length} audience ${
          action === "remove" ? "removals" : "additions"
        }; matching and audience size are separate.`
      );
      return accepted(ctx, batch, action);
    }
    await log(
      "OpenAI reported the audience change as failed; part of it may have been applied. Check the audience in Ads Manager before resetting the sync. Provider error text is omitted."
    );
    return rejectedOperation(ctx, batch, action, done.failure_reason?.code ?? undefined);
  }
  async function submit(ctx: Context, batch: WriteBatch<JsonObject>, action: Action) {
    if (!batch.records.length || batch.records.length > batchSize)
      throw new Error("Invalid OpenAI audience batch size");
    return apply(ctx, batch, action);
  }

  const createWriter = async (ctx: Context) => {
    assertContext(ctx, targetIdentity, options, credentials);
    if (ctx.mode === "mirror" && !managed) throw new Error("Existing OpenAI audiences cannot be mirrored");
    return {
      init: async () => {},
      upsert: (batch: WriteBatch<JsonObject>) => submit(ctx, batch, "upsert"),
      remove: (batch: WriteBatch<JsonObject>) => submit(ctx, batch, "remove"),
      finish: async () => ({ delivery: "accepted" as const }),
      abort: async () => {},
    };
  };
  const rawStream: ReverseEtlStream<JsonObject, JsonObject, JsonObject> = {
    name: "audience",
    displayName: "Custom Audiences",
    options: OpenAiAudienceOptions as z.ZodType<JsonObject>,
    rowType: OpenAiAudienceRow.transform(row => normalizeOpenAiAudience(row)) as z.ZodType<JsonObject>,
    removeRowType: OpenAiAudienceRow.transform(row => normalizeOpenAiAudience(row)) as z.ZodType<JsonObject>,
    batchSize,
    capabilities: {
      supportsUpsert: true,
      supportsExplicitRemove: true,
      mirror: managed ? "snapshot-diff" : "none",
      replay: "idempotency-key",
    },
    createWriter,
  };
  const mirrorStream = {
    ...rawStream,
    rowType: openAiAudienceWire as z.ZodType<JsonObject>,
    removeRowType: openAiAudienceWire as z.ZodType<JsonObject>,
  };
  return {
    options,
    credentials,
    targetIdentity,
    stream: managed ? mirrorStream : rawStream,
    project: projectOpenAiAudience,
    ...(managed
      ? {
          mirror: {
            stream: mirrorStream,
            projection: {
              rowType: rawStream.rowType,
              project: (row: JsonObject) => projectOpenAiAudience("upsert", row),
            },
            // The writer waits for each operation, so a batch is accepted only once OpenAI says it succeeded, and
            // removals can only follow accepted additions.
            batchDelivery: "accepted" as const,
          },
          verifyMirrorBaseline: async () => {
            await resolved.verify();
            return "tracked" as const;
          },
        }
      : {}),
    recovery: () => ({
      attachWriter: createWriter,
      reconcileInit: async () => "absent" as const,
      reconcileAbort: async () => {},
      reconcileFinish: async () => ({ delivery: "accepted" as const }),
      // A saved receipt settles the batch. Without one, replay the SAME request under the SAME key: OpenAI returns the
      // original operation (running or finished), so nothing is applied twice.
      reconcileBatch: async (batch, action, saved, ctx) => {
        assertContext(ctx, targetIdentity, options, credentials);
        const prior = savedReceipt(ctx, batch, saved, action);
        if (prior) return prior;
        await log("Replaying the saved OpenAI audience request under its original idempotency key.");
        return apply(ctx, batch, action);
      },
    }),
  };
}
