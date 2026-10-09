import { z } from "zod";
import type {
  BatchResult,
  JsonObject,
  ReverseEtlContext,
  ReverseEtlStream,
  WriteBatch,
} from "@jitsu/protocols/reverse-etl";
import type {
  DestinationServices,
  ReverseDestinationConfig,
  ReverseRuntimeAdapter,
} from "@jitsu/protocols/reverse-etl-runtime";
import { contentHash } from "../../reverse-etl/identity";
import { createReverseEtlRegistry } from "../../reverse-etl";
import { validateBatchResult } from "../../reverse-etl/meta";
import {
  MicrosoftAudienceOptions,
  MicrosoftAudienceRow,
  MicrosoftConversionOptions,
  MicrosoftConversionRow,
  MicrosoftRuntimeCredentials,
  validateMicrosoftSettings,
} from "./meta";
import {
  MicrosoftAudienceWire,
  MicrosoftConversionWire,
  normalizeMicrosoftAudience,
  normalizeMicrosoftConversion,
  projectMicrosoftAudience,
} from "./normalize";
import {
  microsoftClient,
  MicrosoftApiError,
  MicrosoftUncertainDelivery,
  microsoftPartialErrors,
  microsoftLog,
} from "./client";
import { resolveMicrosoftAudience } from "./provisioning";

type Context = ReverseEtlContext<JsonObject, JsonObject>;
type Action = "upsert" | "remove";
export async function createMicrosoftAdsRuntime(
  config: ReverseDestinationConfig,
  services: DestinationServices
): Promise<ReverseRuntimeAdapter> {
  validateMicrosoftSettings(
    config.options as Parameters<typeof validateMicrosoftSettings>[0],
    config.model,
    config.destination
  );
  const credentials = MicrosoftRuntimeCredentials.parse(config.destination);
  if (credentials.oauthConnectionId !== `destination.${config.toId}`)
    throw new Error("Microsoft OAuth connection does not match this destination");
  const request = microsoftClient(credentials, services);
  const isAudience = config.options.stream === "audience";
  const options = (isAudience ? MicrosoftAudienceOptions : MicrosoftConversionOptions).parse(
    config.options.streamOptions
  ) as JsonObject;
  const name = String(options.conversionName ?? "");
  const rawRow = isAudience
    ? MicrosoftAudienceRow.transform(normalizeMicrosoftAudience)
    : MicrosoftConversionRow.transform(row => normalizeMicrosoftConversion(row, name));
  const wire = isAudience ? MicrosoftAudienceWire : MicrosoftConversionWire;
  const project: ReverseRuntimeAdapter["project"] = isAudience
    ? projectMicrosoftAudience
    : (_action, row) => {
        const parsed = MicrosoftConversionWire.parse(row);
        return [{ identity: { eventKey: parsed.key }, upsert: parsed, remove: {} }];
      };
  // validateSource is idempotent at this scope: avoid staging the model twice when creating a fresh intent.
  let validated = false;
  const target = isAudience
    ? await resolveMicrosoftAudience(config, services, request, async () => {
        if (validated) return;
        if (!services.validateSource) throw new Error("Microsoft audience creation requires source preflight");
        await services.validateSource({
          stream: { rowType: wire, removeRowType: wire } as any,
          projection: { rowType: rawRow as z.ZodType<JsonObject>, project: row => project("upsert", row) },
        });
        validated = true;
      })
    : undefined;
  const targetIdentity = isAudience
    ? `microsoft-audience:${target!.id}`
    : `microsoft-offline-conversions:${credentials.customerId}:${credentials.accountId}:${contentHash(name)}`;
  const assertContext = (ctx: Context) => {
    if (
      ctx.targetIdentity !== targetIdentity ||
      contentHash(ctx.options) !== contentHash(options) ||
      contentHash(ctx.credentials) !== contentHash(credentials) ||
      ctx.mode !== (target?.managed ? "mirror" : "upsert")
    )
      throw new Error("Microsoft writer binding does not match the saved stream, target and settings");
  };
  const binding = (ctx: Context, batch: WriteBatch<JsonObject>, action: Action) =>
    contentHash({
      sync: ctx.syncId,
      run: ctx.logicalRunId,
      revision: ctx.configRevision,
      target: ctx.targetIdentity,
      action,
      batch,
    });
  const createWriter = async (ctx: Context) => {
    assertContext(ctx);
    const submit = async (batch: WriteBatch<JsonObject>, action: Action): Promise<BatchResult> => {
      if (!batch.records.length || batch.records.length > 1000 || (!isAudience && action === "remove"))
        throw new Error("Invalid Microsoft Ads batch");
      const rows = batch.records.map(r => wire.parse(r.row));
      const body = isAudience
        ? {
            CustomerListUserData: {
              ActionType: action === "upsert" ? "Add" : "Remove",
              AudienceId: target!.id,
              CustomerListItemSubType: "Email",
              CustomerListItems: rows.map(r => (r as z.infer<typeof MicrosoftAudienceWire>).email),
              ...(options.acceptCustomerMatchTerms ? { AcceptCustomerMatchTerm: true } : {}),
            },
          }
        : { OfflineConversions: rows.map(r => (r as z.infer<typeof MicrosoftConversionWire>).payload) };
      let errors: z.infer<typeof microsoftPartialErrors>;
      try {
        const response = await request(
          isAudience ? "CustomerListUserData/Apply" : "OfflineConversions/Apply",
          body,
          ctx.signal
        );
        // Require the documented response envelope, not just HTTP 200 or arbitrary JSON.
        if (!Object.hasOwn(response, "PartialErrors")) throw new MicrosoftUncertainDelivery();
        const parsed = microsoftPartialErrors.safeParse(response.PartialErrors ?? []);
        if (!parsed.success || parsed.data.some(e => e.Index >= rows.length)) throw new MicrosoftUncertainDelivery();
        errors = parsed.data;
      } catch (error) {
        if (!(error instanceof MicrosoftApiError) || !error.rejected) throw error;
        errors = rows.map((_, Index) => ({ Index, Code: error.codes[0] ?? error.status }));
      }
      const failures = new Map(errors.map(e => [e.Index, e.Code]));
      const result: BatchResult = {
        submitted: true,
        providerCheckpoint: { binding: binding(ctx, batch, action) },
        outcomes: batch.records.map((r, i) =>
          failures.has(i)
            ? {
                operationId: r.operationId,
                status: "rejected",
                code: `MICROSOFT_${failures.get(i)}`,
                safeReason: "Microsoft rejected this record; check stream mappings and account permissions",
              }
            : { operationId: r.operationId, status: "accepted" }
        ),
      };
      await microsoftLog(
        services,
        `Microsoft Ads acknowledged ${rows.length} ${isAudience ? "audience" : "conversion"} records: ${
          rows.length - failures.size
        } accepted, ${failures.size} rejected. Acceptance is not matching or attribution.${
          failures.size ? ` Error codes: ${[...new Set(failures.values())].join(", ")}.` : ""
        }`
      );
      return result;
    };
    return {
      init: async () => {},
      upsert: (batch: WriteBatch<JsonObject>) => submit(batch, "upsert"),
      ...(isAudience ? { remove: (batch: WriteBatch<JsonObject>) => submit(batch, "remove") } : {}),
      finish: async () => ({ delivery: "accepted" as const }),
      abort: async () => {},
      reconcile: async (): Promise<never> => {
        throw new MicrosoftUncertainDelivery();
      },
    };
  };
  const stream: ReverseEtlStream<JsonObject, JsonObject, JsonObject> = {
    name: config.options.stream,
    displayName: isAudience ? "Customer Match audiences" : "Offline conversions",
    rowType: rawRow as z.ZodType<JsonObject>,
    ...(isAudience ? { removeRowType: rawRow as z.ZodType<JsonObject> } : {}),
    options: (isAudience ? MicrosoftAudienceOptions : MicrosoftConversionOptions) as z.ZodType<JsonObject>,
    batchSize: 1000,
    capabilities: {
      supportsUpsert: true,
      supportsExplicitRemove: isAudience,
      mirror: target?.managed ? "snapshot-diff" : "none",
      replay: "reconcile-required",
    },
    createWriter,
  };
  const mirrorStream = {
    ...stream,
    rowType: MicrosoftAudienceWire as z.ZodType<JsonObject>,
    removeRowType: MicrosoftAudienceWire as z.ZodType<JsonObject>,
  };
  createReverseEtlRegistry({
    "builtin.reverse.microsoft-ads": {
      credentials: MicrosoftRuntimeCredentials,
      defaultStream: stream.name,
      streams: [target?.managed ? mirrorStream : stream],
    },
  });
  return {
    credentials: credentials as JsonObject,
    options,
    targetIdentity,
    stream: target?.managed ? mirrorStream : stream,
    project,
    insertOnly: !isAudience,
    ...(target?.managed
      ? {
          mirror: {
            stream: mirrorStream,
            projection: { rowType: rawRow as z.ZodType<JsonObject>, project: row => project("upsert", row) },
            batchDelivery: "accepted" as const,
          },
          verifyMirrorBaseline: async () => {
            await target.verify();
            return "tracked" as const;
          },
        }
      : {}),
    recovery: () => ({
      attachWriter: createWriter,
      reconcileInit: async () => "absent" as const,
      reconcileAbort: async () => {},
      reconcileFinish: async (_saved, ctx) => {
        assertContext(ctx);
        return { delivery: "accepted" };
      },
      reconcileBatch: async (batch, action, saved, ctx) => {
        assertContext(ctx);
        if (
          saved &&
          saved.providerCheckpoint?.binding === binding(ctx, batch, action) &&
          saved.outcomes.every(r => r.status !== "staged")
        )
          return validateBatchResult(batch, saved);
        await microsoftLog(
          services,
          "Microsoft Ads has no saved acknowledgement for this request. No automatic replay; contact your Jitsu administrator with this run ID. Do not reset sync state."
        );
        throw new MicrosoftUncertainDelivery();
      },
    }),
  };
}
