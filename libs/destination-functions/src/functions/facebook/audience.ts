import { z } from "zod";
import type { JsonObject, ReverseEtlStream, WriteBatch } from "@jitsu/protocols/reverse-etl";
import type { DestinationServices, ReverseRuntimeAdapter } from "@jitsu/protocols/reverse-etl-runtime";
import { MetaAudienceOptions, MetaAudienceRow, metaContactFields } from "./reverse-meta";
import { metaHashes, metaInvalid } from "./identifiers";
import { MetaApiError, metaLog, metaRequest } from "./client";
import {
  accepted,
  Action,
  assertContext,
  Context,
  MetaUncertainDelivery,
  metaSessionId,
  rejected,
  savedReceipt,
} from "./delivery";

const cell = z.union([z.string(), z.number().finite(), z.array(z.string())]);
const memberSchema = z.record(cell);
export const metaAudienceWire = z.object({ member: memberSchema, identity: z.record(z.string()) }).strict();
const extras = [
  ["firstInitial", "hashedFirstInitial", "FI"],
  ["birthYear", "hashedBirthYear", "DOBY"],
  ["birthMonth", "hashedBirthMonth", "DOBM"],
  ["birthDay", "hashedBirthDay", "DOBD"],
] as const;
export function metaPrivacy(row: Record<string, any>) {
  const result: Record<string, any> = {};
  if (row.dataProcessingOptions != null) {
    if (row.dataProcessingOptions.some((v: unknown) => v !== "LDU")) metaInvalid();
    result.data_processing_options = row.dataProcessingOptions;
  }
  if (row.dataProcessingCountry != null) result.data_processing_options_country = row.dataProcessingCountry;
  if (row.dataProcessingState != null) result.data_processing_options_state = row.dataProcessingState;
  return result;
}
export function normalizeMetaAudience(
  input: unknown,
  settings: z.infer<typeof MetaAudienceOptions>,
  action: Action
): JsonObject {
  const row = MetaAudienceRow.parse(input) as Record<string, any>;
  const matching: Record<string, string> = {};
  for (const [raw, hashed, , wire] of metaContactFields) {
    const hashes = metaHashes(row, raw, hashed);
    if (hashes.length) matching[wire] = hashes[0];
  }
  for (const [raw, hashed, wire] of extras) {
    const hashes = metaHashes(row, raw, hashed);
    if (hashes.length) matching[wire] = hashes[0];
  }
  if (row.externalId) {
    if (!row.externalId.trim()) metaInvalid();
    matching.EXTERN_ID = row.externalId;
  }
  if (row.mobileAdvertisingId) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.mobileAdvertisingId)) metaInvalid();
    matching.MADID = row.mobileAdvertisingId.toLowerCase();
  }
  if (row.pageScopedUserId) {
    if (!settings.pageId || !/^[1-9][0-9]+$/.test(row.pageScopedUserId)) metaInvalid();
    matching.PAGEUID = row.pageScopedUserId;
  }
  const key = ["EXTERN_ID", "EMAIL", "PHONE", "MADID", "PAGEUID"].find(k => matching[k]);
  // Meta supports multiple demographic combinations. Do not impose an email,
  // phone, country or postcode requirement on otherwise mapped identifiers.
  if (!Object.keys(matching).length) metaInvalid();
  const identity = key ? { [key]: matching[key] } : matching;
  const member: Record<string, any> = { ...(action === "remove" ? identity : matching) };
  if (action === "upsert") {
    if (settings.valueBased && row.lookalikeValue == null) metaInvalid();
    if (!settings.valueBased && row.lookalikeValue != null) metaInvalid();
    if (row.lookalikeValue != null) member.LOOKALIKE_VALUE = row.lookalikeValue;
    const privacy = metaPrivacy(row);
    if (privacy.data_processing_options !== undefined) member.DATA_PROCESSING_OPTIONS = privacy.data_processing_options;
    if (privacy.data_processing_options_country !== undefined)
      member.DATA_PROCESSING_OPTIONS_COUNTRY = privacy.data_processing_options_country;
    if (privacy.data_processing_options_state !== undefined)
      member.DATA_PROCESSING_OPTIONS_STATE = privacy.data_processing_options_state;
  }
  return { member, identity };
}
export function projectMetaAudience(_action: Action, input: unknown) {
  const row = metaAudienceWire.parse(input);
  return [
    { identity: row.identity, upsert: row as JsonObject, remove: { member: row.identity, identity: row.identity } },
  ];
}
const receipt = z.object({
  audience_id: z.string(),
  session_id: z.union([z.string(), z.number().int().safe()]),
  num_received: z.number().int().nonnegative(),
  num_invalid_entries: z.number().int().nonnegative(),
});

export function createMetaAudience(
  credentials: JsonObject,
  options: JsonObject,
  audienceId: string,
  managed: boolean,
  services: DestinationServices,
  verify: () => Promise<void>
): ReverseRuntimeAdapter {
  const settings = MetaAudienceOptions.parse(options);
  const targetIdentity = `meta-audience:${settings.accountId}:${audienceId}`;
  const token = String(credentials.accessToken);
  const log = (message: string) => metaLog(services.log, message);
  async function submit(ctx: Context, batch: WriteBatch<JsonObject>, action: Action) {
    if (!batch.records.length || batch.records.length > 1000) throw new Error("Invalid Meta audience batch size");
    const rows = batch.records.map(r => metaAudienceWire.parse(r.row).member);
    const schema = [...new Set(rows.flatMap(r => Object.keys(r)))].sort();
    const sessionId = metaSessionId(ctx, batch, action);
    try {
      const result = receipt.safeParse(
        await metaRequest(
          ctx.fetch,
          token,
          ctx.signal,
          `${audienceId}/users`,
          action === "remove" ? "DELETE" : "POST",
          {
            payload: {
              schema,
              data: rows.map(row => schema.map(field => row[field] ?? "")),
              ...(settings.pageId ? { page_ids: [settings.pageId] } : {}),
            },
            session: { session_id: sessionId, batch_seq: 1, last_batch_flag: true, estimated_num_total: rows.length },
          }
        )
      );
      if (
        !result.success ||
        result.data.audience_id !== audienceId ||
        String(result.data.session_id) !== String(sessionId) ||
        result.data.num_received !== rows.length ||
        result.data.num_invalid_entries !== 0
      ) {
        await log(
          "Meta returned incomplete or invalid audience receipt counts; per-record acceptance cannot be established. No automatic replay."
        );
        throw new MetaUncertainDelivery();
      }
      await log(
        `Meta acknowledged ${rows.length} audience ${
          action === "remove" ? "removals" : "uploads"
        } (session ${sessionId}); matching and audience-size estimates are separate.`
      );
      return accepted(ctx, batch, action);
    } catch (error) {
      if (error instanceof MetaApiError) {
        await log(
          `${error.message}; audience request ${
            error.rejected ? "rejected" : "unconfirmed"
          }. Provider error text and row samples are omitted.`
        );
        if (error.rejected) return rejected(ctx, batch, action, error);
      }
      throw error;
    }
  }
  const createWriter = async (ctx: Context) => {
    assertContext(ctx, targetIdentity, options, credentials);
    if (ctx.mode === "mirror" && !managed) throw new Error("Existing Meta audiences cannot be mirrored");
    return {
      init: async () => {},
      upsert: (batch: WriteBatch<JsonObject>) => submit(ctx, batch, "upsert"),
      remove: (batch: WriteBatch<JsonObject>) => submit(ctx, batch, "remove"),
      finish: async () => ({ delivery: "accepted" as const }),
      abort: async () => {},
      reconcile: async () => {
        throw new Error("Reconcile Meta audience batches using their saved session IDs");
      },
    };
  };
  const rawStream: ReverseEtlStream<JsonObject, JsonObject, JsonObject> = {
    name: "audience",
    displayName: "Custom Audiences",
    options: MetaAudienceOptions as z.ZodType<JsonObject>,
    rowType: MetaAudienceRow.transform(row => normalizeMetaAudience(row, settings, "upsert")) as z.ZodType<JsonObject>,
    removeRowType: MetaAudienceRow.transform(row =>
      normalizeMetaAudience(row, settings, "remove")
    ) as z.ZodType<JsonObject>,
    batchSize: 1000,
    capabilities: {
      supportsUpsert: true,
      supportsExplicitRemove: true,
      mirror: managed ? "snapshot-diff" : "none",
      replay: "reconcile-required",
    },
    createWriter,
  };
  const mirrorStream = {
    ...rawStream,
    rowType: metaAudienceWire as z.ZodType<JsonObject>,
    removeRowType: metaAudienceWire as z.ZodType<JsonObject>,
  };
  return {
    options,
    credentials,
    targetIdentity,
    stream: managed ? mirrorStream : rawStream,
    project: projectMetaAudience,
    ...(managed
      ? {
          mirror: {
            stream: mirrorStream,
            projection: {
              rowType: rawStream.rowType,
              project: (row: JsonObject) => projectMetaAudience("upsert", row),
            },
            batchDelivery: "accepted" as const,
            // Meta retains external-ID mappings for 90 days. Refresh during normal
            // runs, using the core's acknowledged-member timestamp, not provider state.
            refreshAfterMs: 30 * 86400_000,
          },
          verifyMirrorBaseline: async () => {
            await verify();
            return "tracked" as const;
          },
        }
      : {}),
    recovery: () => ({
      attachWriter: createWriter,
      reconcileInit: async () => "absent" as const,
      reconcileAbort: async () => {},
      reconcileFinish: async () => ({ delivery: "accepted" as const }),
      reconcileBatch: async (batch, action, saved, ctx) => {
        assertContext(ctx, targetIdentity, options, credentials);
        const prior = savedReceipt(ctx, batch, action, saved);
        if (prior) return prior;
        const sessionId = metaSessionId(ctx, batch, action);
        const sessions = z
          .object({
            data: z.array(
              z.object({
                session_id: z.union([z.string(), z.number().int().safe()]),
                num_received: z.number().int().nonnegative(),
                num_invalid_entries: z.number().int().nonnegative(),
              })
            ),
          })
          .parse(
            await metaRequest(
              ctx.fetch,
              token,
              ctx.signal,
              `${audienceId}/sessions?session_id=${sessionId}&fields=session_id,num_received,num_invalid_entries`
            )
          );
        const matching = sessions.data.filter(s => String(s.session_id) === String(sessionId));
        if (
          matching.length !== 1 ||
          matching[0].num_received !== batch.records.length ||
          matching[0].num_invalid_entries !== 0
        )
          throw new MetaUncertainDelivery();
        await log(
          `Meta session ${sessionId} confirms receipt of all ${batch.records.length} records; matching is not measured by these counts.`
        );
        return accepted(ctx, batch, action);
      },
    }),
  };
}
