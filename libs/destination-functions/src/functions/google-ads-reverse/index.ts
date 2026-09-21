import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  BatchResult,
  FinishResult,
  JsonObject,
  ReverseEtlContext,
  ReverseEtlDestination,
  ReverseEtlStream,
  ReverseEtlWriter,
  WriteBatch,
} from "@jitsu/protocols/reverse-etl";
import { contentHash } from "../../reverse-etl/identity";
import { ReverseEtlProtocolError, validateBatchResult } from "../../reverse-etl/meta";
import {
  GoogleAudienceCredentials,
  GoogleAudienceOptions,
  GoogleAudienceRow,
  GoogleAudienceRemoveRow,
  googleAudienceMetadata,
  GoogleManagedAudience,
} from "./meta";

type Context = ReverseEtlContext<JsonObject, JsonObject>;
type Action = "upsert" | "remove";
export type GoogleAccessToken = (signal: AbortSignal) => Promise<string>;
const baseUrl = "https://datamanager.googleapis.com/v1/";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (message: string): never => {
  throw new ReverseEtlProtocolError(message);
};

function email(value: string) {
  const normalized = value.toLowerCase().replace(/\s/g, "");
  const parts = normalized.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1].includes(".")) fail("Invalid Google audience email");
  if (["gmail.com", "googlemail.com"].includes(parts[1])) parts[0] = parts[0].split("+")[0].replace(/\./g, "");
  if (!parts[0]) fail("Invalid Google audience email");
  return digest(parts.join("@"));
}
function phone(value: string) {
  const normalized = value.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) fail("Google audience phone requires E.164 with country code");
  return digest(normalized);
}

/** Only this source-row boundary hashes. Journal/recovery schemas accept hashes only. */
function normalize(row: z.infer<typeof GoogleAudienceRemoveRow>, action: Action): JsonObject {
  if ((row.email && row.hashedEmail) || (row.phone && row.hashedPhone))
    fail("Choose raw or hashed for each identifier");
  const userIdentifiers: JsonObject[] = [];
  if (row.email || row.hashedEmail)
    userIdentifiers.push({ emailAddress: row.email ? email(row.email) : row.hashedEmail!.toLowerCase() });
  if (row.phone || row.hashedPhone)
    userIdentifiers.push({ phoneNumber: row.phone ? phone(row.phone) : row.hashedPhone!.toLowerCase() });
  if (!userIdentifiers.length) fail("Google audience row requires an email or phone identifier");
  return {
    userData: { userIdentifiers },
    ...(action === "upsert"
      ? { consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" } }
      : {}),
  };
}
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const wireIdentifiers = z
  .array(z.union([z.object({ emailAddress: hex }).strict(), z.object({ phoneNumber: hex }).strict()]))
  .min(1)
  .max(2);
const wireRemove = z.object({ userData: z.object({ userIdentifiers: wireIdentifiers }).strict() }).strict();
const wireUpsert = wireRemove.extend({
  consent: z
    .object({ adUserData: z.literal("CONSENT_GRANTED"), adPersonalization: z.literal("CONSENT_GRANTED") })
    .strict(),
});
const wire = (action: Action, row: unknown) => {
  const parsed = (action === "upsert" ? wireUpsert : wireRemove).safeParse(row);
  if (!parsed.success) return fail("Invalid persisted Google audience payload");
  return parsed.data;
};

/** Shared identifiers collide even if different source rows group email/phone differently. */
export function projectGoogleAudience(action: Action, row: unknown) {
  const member = wire(action, row);
  return member.userData.userIdentifiers.map(identifier => ({
    identity: identifier as JsonObject,
    upsert: {
      userData: { userIdentifiers: [identifier] },
      consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
    } as JsonObject,
    remove: { userData: { userIdentifiers: [identifier] } } as JsonObject,
  }));
}

function target(credentials: unknown, options: unknown) {
  const c = GoogleAudienceCredentials.safeParse(credentials);
  const o = GoogleAudienceOptions.safeParse(options);
  if (!c.success || !o.success) return fail("Invalid Google audience configuration");
  return {
    operatingAccount: { accountType: "GOOGLE_ADS", accountId: c.data.customerId },
    ...(c.data.loginCustomerId
      ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: c.data.loginCustomerId } }
      : {}),
    productDestinationId: o.data.audienceId,
  };
}
export function googleAudienceTargetIdentity(credentials: unknown, options: unknown) {
  const t = target(credentials, options);
  return `google-data-manager:${t.operatingAccount.accountId}:${t.productDestinationId}`;
}

const requestId = z.string().min(1).max(512);
const receipt = z
  .object({
    version: z.literal(1),
    action: z.enum(["upsert", "remove"]),
    requestId,
    binding: hex,
    submissionWarnings: z.boolean(),
  })
  .strict();
const submission = z.object({ requestId, fieldWarnings: z.array(z.unknown()).optional() });
const replacementState = z.object({ version: z.literal(1), cutoff: z.string().datetime(), binding: hex }).strict();
const replacementReceipt = replacementState.extend({ action: z.literal("replace"), requestId }).strict();
const replacementKey = "googleAudienceReplacement";
const account = z.object({ accountType: z.literal("GOOGLE_ADS"), accountId: z.string() });
const destination = z.object({
  operatingAccount: account,
  loginAccount: account.optional(),
  productDestinationId: z.string(),
});
const counts = z.object({ recordCount: z.string().regex(/^\d+$/), reason: z.string().optional() });
const stats = z.object({ recordCount: z.string().regex(/^\d+$/) });
const statusResponse = z.object({
  requestStatusPerDestination: z
    .array(
      z.object({
        destination,
        requestStatus: z.string(),
        errorInfo: z.object({ errorCounts: z.array(counts).optional() }).optional(),
        warningInfo: z.object({ warningCounts: z.array(counts).optional() }).optional(),
        audienceMembersIngestionStatus: z.object({ userDataIngestionStatus: stats.optional() }).optional(),
        audienceMembersRemovalStatus: z.object({ userDataRemovalStatus: stats.optional() }).optional(),
        removeAllAudienceMembersStatus: z.object({}).strict().optional(),
        eventsIngestionStatus: z.unknown().optional(),
      })
    )
    .length(1),
});

/** Provider-only implementation: caller supplies a scoped OAuth resolver, never a Nango secret. */
export function createGoogleDataManager(
  getAccessToken: GoogleAccessToken,
  managed?: GoogleManagedAudience,
  strategy: "snapshot-diff" | "native-replace" = "snapshot-diff"
) {
  const replacement = strategy === "native-replace";
  const replacementBinding = (ctx: Context) =>
    contentHash({
      target: target(ctx.credentials, ctx.options),
      syncId: ctx.syncId,
      run: ctx.logicalRunId,
      revision: ctx.configRevision,
      strategy: "native-replace",
    });
  function replacementFor(ctx: Context) {
    const saved = replacementState.safeParse(ctx.store.get(replacementKey));
    if (!saved.success || saved.data.binding !== replacementBinding(ctx))
      return fail("Google replacement cutoff is missing or bound to another run; do not reset or replay");
    return saved.data;
  }
  const binding = (ctx: Context, batch: WriteBatch<JsonObject>, action: Action) =>
    contentHash({ target: target(ctx.credentials, ctx.options), revision: ctx.configRevision, batch, action });
  async function request(
    ctx: Context,
    path: string,
    body?: unknown,
    accessToken?: string,
    clock?: (date: string | null) => void
  ): Promise<unknown> {
    ctx.signal.throwIfAborted();
    const token = accessToken ?? (await getAccessToken(ctx.signal));
    const loginCustomerId = path.startsWith("accountTypes/")
      ? GoogleAudienceCredentials.parse(ctx.credentials).loginCustomerId
      : "";
    ctx.signal.throwIfAborted();
    try {
      const response = await ctx.fetch(`${baseUrl}${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: ctx.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(loginCustomerId ? { "login-account": `accountTypes/GOOGLE_ADS/accounts/${loginCustomerId}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      // Never echo provider responses or network errors: they can include tokens/PII.
      // Even 401/429/5xx POSTs are not replayed: there is no client idempotency key.
      if (!response.ok) fail(`Google Data Manager HTTP ${response.status}; reconcile before retrying delivery`);
      clock?.(response.headers.get("date"));
      return await response.json();
    } catch {
      return fail("Google Data Manager request failed; preserve recovery evidence and do not replay");
    }
  }
  async function submit(ctx: Context, batch: WriteBatch<JsonObject>, action: Action): Promise<BatchResult> {
    if (replacement) {
      replacementFor(ctx);
      if (action !== "upsert") fail("Full replacement does not use individual removals");
    }
    if (!batch.records.length || batch.records.length > 1000) fail("Invalid Google audience batch size");
    const audienceMembers = batch.records.map(record => wire(action, record.row));
    ctx.signal.throwIfAborted();
    let token: string;
    try {
      token = await getAccessToken(ctx.signal);
    } catch {
      // Definitively not submitted: OAuth failure must not strand this batch as
      // an unknown Google request. Core persists rejection and fails this run.
      return {
        outcomes: batch.records.map(({ operationId }) => ({
          operationId,
          status: "rejected",
          code: "GOOGLE_AUTH_UNAVAILABLE",
          safeReason: "OAuth unavailable; no Google request was submitted",
        })),
      };
    }
    const parsed = submission.safeParse(
      await request(
        ctx,
        `audienceMembers:${action === "upsert" ? "ingest" : "remove"}`,
        {
          destinations: [target(ctx.credentials, ctx.options)],
          audienceMembers,
          encoding: "HEX",
          ...(action === "upsert" ? { termsOfService: { customerMatchTermsOfServiceStatus: "ACCEPTED" } } : {}),
        },
        token
      )
    );
    if (!parsed.success) return fail("Google submission has no valid request receipt; manual reconciliation required");
    return {
      outcomes: batch.records.map(({ operationId }) => ({ operationId, status: "staged" })),
      remoteJobIds: [parsed.data.requestId],
      providerCheckpoint: {
        version: 1,
        action,
        requestId: parsed.data.requestId,
        binding: binding(ctx, batch, action),
        submissionWarnings: !!parsed.data.fieldWarnings?.length,
      },
    };
  }
  async function reconcileBatch(
    batch: WriteBatch<JsonObject>,
    action: Action,
    saved: BatchResult | undefined,
    ctx: Context
  ): Promise<BatchResult> {
    const checkpoint = receipt.safeParse(saved?.providerCheckpoint);
    if (!saved || !checkpoint.success)
      return fail("Google request ID unavailable; manual reconciliation required, no automatic replay");
    validateBatchResult(batch, saved);
    if (
      checkpoint.data.action !== action ||
      checkpoint.data.binding !== binding(ctx, batch, action) ||
      saved.remoteJobIds?.length !== 1 ||
      saved.remoteJobIds[0] !== checkpoint.data.requestId ||
      saved.outcomes.some(outcome => outcome.status !== "staged")
    )
      fail("Google recovery receipt does not match this batch");
    batch.records.forEach(record => wire(action, record.row));
    const parsed = statusResponse.safeParse(
      await request(ctx, `requestStatus:retrieve?requestId=${encodeURIComponent(checkpoint.data.requestId)}`)
    );
    if (!parsed.success) return fail("Malformed Google request status; manual reconciliation required");
    const status = parsed.data.requestStatusPerDestination[0];
    if (contentHash(status.destination) !== contentHash(target(ctx.credentials, ctx.options)))
      fail("Google status target mismatch");
    if (status.requestStatus === "PROCESSING" || status.requestStatus === "REQUEST_STATUS_UNKNOWN") return saved;
    if (status.requestStatus === "FAILED")
      return {
        ...saved,
        outcomes: batch.records.map(({ operationId }) => ({
          operationId,
          status: "rejected",
          code: "GOOGLE_REQUEST_FAILED",
          safeReason: "Google rejected all records in this request",
        })),
      };
    const recordCount =
      action === "upsert"
        ? status.audienceMembersIngestionStatus?.userDataIngestionStatus?.recordCount
        : status.audienceMembersRemovalStatus?.userDataRemovalStatus?.recordCount;
    if (
      status.requestStatus !== "SUCCESS" ||
      checkpoint.data.submissionWarnings ||
      status.errorInfo !== undefined ||
      status.warningInfo !== undefined ||
      status.removeAllAudienceMembersStatus !== undefined ||
      status.eventsIngestionStatus !== undefined ||
      recordCount !== String(batch.records.length) ||
      (action === "upsert" ? status.audienceMembersRemovalStatus : status.audienceMembersIngestionStatus)
    )
      return fail(
        "Google result is partial, warned or unverified; manual reconciliation required, no automatic replay"
      );
    return { ...saved, outcomes: batch.records.map(({ operationId }) => ({ operationId, status: "accepted" })) };
  }
  async function finishReplacement(ctx: Context): Promise<FinishResult> {
    const state = replacementFor(ctx);
    // Core prepares finish only after every sealed snapshot upload is accepted.
    const result = submission.safeParse(
      await request(ctx, "audienceMembers:removeAll", {
        destinations: [target(ctx.credentials, ctx.options)],
        removeAsOfTime: state.cutoff,
      })
    );
    if (!result.success || result.data.fieldWarnings?.length)
      return fail(
        "Google replacement cleanup receipt unavailable; manual reconciliation required, no automatic replay"
      );
    return {
      delivery: "pending",
      remoteJobIds: [result.data.requestId],
      providerCheckpoint: { ...state, action: "replace", requestId: result.data.requestId },
    };
  }
  async function reconcileFinish(saved: FinishResult | undefined, ctx: Context): Promise<FinishResult> {
    if (!replacement) return { delivery: "accepted" };
    const state = replacementFor(ctx);
    const receipt = replacementReceipt.safeParse(saved?.providerCheckpoint);
    if (
      !saved ||
      saved.delivery !== "pending" ||
      !receipt.success ||
      receipt.data.binding !== state.binding ||
      receipt.data.cutoff !== state.cutoff ||
      saved.remoteJobIds?.length !== 1 ||
      saved.remoteJobIds[0] !== receipt.data.requestId
    )
      return fail(
        "Google replacement cleanup receipt unavailable; manual reconciliation required, no automatic replay"
      );
    const parsed = statusResponse.safeParse(
      await request(ctx, `requestStatus:retrieve?requestId=${encodeURIComponent(receipt.data.requestId)}`)
    );
    if (!parsed.success) return fail("Malformed Google replacement status; manual reconciliation required");
    const status = parsed.data.requestStatusPerDestination[0];
    if (contentHash(status.destination) !== contentHash(target(ctx.credentials, ctx.options)))
      return fail("Google replacement status target mismatch");
    if (["PROCESSING", "REQUEST_STATUS_UNKNOWN"].includes(status.requestStatus)) return saved;
    if (
      status.requestStatus !== "SUCCESS" ||
      status.errorInfo !== undefined ||
      status.warningInfo !== undefined ||
      status.removeAllAudienceMembersStatus === undefined ||
      status.audienceMembersIngestionStatus !== undefined ||
      status.audienceMembersRemovalStatus !== undefined ||
      status.eventsIngestionStatus !== undefined
    )
      return fail(
        "Google replacement cleanup failed or is unverified; manual reconciliation required, no automatic replay"
      );
    return { ...saved, delivery: "accepted" };
  }
  async function createWriter(ctx: Context): Promise<ReverseEtlWriter<JsonObject>> {
    const options = GoogleAudienceOptions.parse(ctx.options);
    if (replacement !== (options.mirrorStrategy === "full-replace") || (replacement && ctx.mode !== "mirror"))
      fail("Google replacement requires an explicitly configured mirror sync");
    if (ctx.targetIdentity !== googleAudienceTargetIdentity(ctx.credentials, ctx.options))
      fail("Google audience target/mode mismatch");
    if (
      ctx.mode === "mirror" &&
      !replacement &&
      (!managed ||
        managed.syncId !== ctx.syncId ||
        managed.id !== ctx.options.managedAudienceId ||
        managed.audienceId !== ctx.options.audienceId ||
        managed.customerId !== GoogleAudienceCredentials.parse(ctx.credentials).customerId)
    )
      fail("Google mirror requires a verified Jitsu-managed audience");
    return {
      init: async () => {
        if (!replacement) return;
        // Use Google's HTTP clock, not a potentially fast worker clock: a future
        // cutoff could remove the members this run is about to upload. No fallback.
        const c = GoogleAudienceCredentials.parse(ctx.credentials);
        let serverTime: string | null = null;
        const value = await request(
          ctx,
          `accountTypes/GOOGLE_ADS/accounts/${c.customerId}/userLists/${options.audienceId}`,
          undefined,
          undefined,
          date => {
            serverTime = date;
          }
        );
        const list = z.object({ name: z.string(), id: z.string() }).safeParse(value);
        const time = serverTime ? Date.parse(serverTime) : NaN;
        if (
          !list.success ||
          list.data.id !== options.audienceId ||
          list.data.name !== `accountTypes/GOOGLE_ADS/accounts/${c.customerId}/userLists/${options.audienceId}` ||
          !Number.isFinite(time)
        )
          return fail("Google replacement cutoff unavailable; no audience changes submitted");
        // Buffered store is durably saved by acknowledgeInit before any upload.
        ctx.store.set(replacementKey, {
          version: 1,
          cutoff: new Date(time).toISOString(),
          binding: replacementBinding(ctx),
        });
      },
      upsert: batch => submit(ctx, batch, "upsert"),
      remove: batch => submit(ctx, batch, "remove"),
      // Native finish submits cleanup; diff finish and abort are local only.
      // Core must settle independent upload jobs before authorizing either finish.
      finish: async () => (replacement ? finishReplacement(ctx) : { delivery: "accepted" }),
      abort: async () => {},
      reconcile: async remoteJobIds => ({ delivery: "pending", remoteJobIds }),
    };
  }
  const stream: ReverseEtlStream<JsonObject, JsonObject, JsonObject> = {
    ...googleAudienceMetadata,
    capabilities: {
      ...googleAudienceMetadata.capabilities,
      mirror: replacement ? "native-replace" : managed ? "snapshot-diff" : "none",
    },
    rowType: GoogleAudienceRow.transform((row, ctx) => {
      try {
        return normalize(row, "upsert");
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid Google audience identifiers" });
        return z.NEVER;
      }
    }) as z.ZodType<JsonObject>,
    removeRowType: GoogleAudienceRemoveRow.transform((row, ctx) => {
      try {
        return normalize(row, "remove");
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid Google audience identifiers" });
        return z.NEVER;
      }
    }) as z.ZodType<JsonObject>,
    createWriter,
  };
  const destination: ReverseEtlDestination<JsonObject> = {
    credentials: GoogleAudienceCredentials as z.ZodType<JsonObject>,
    streams: [stream],
    defaultStream: stream.name,
  };
  return {
    destination,
    stream,
    // Mirror projects source rows once; delivery validates already hashed wire
    // payloads, so recovery and expiry refresh never normalize/hash twice.
    mirrorStream: { ...stream, rowType: wireUpsert, removeRowType: wireRemove },
    recovery: {
      attachWriter: createWriter,
      reconcileBatch,
      reconcileInit: async () => "absent" as const,
      reconcileAbort: async () => {},
      reconcileFinish,
    },
  };
}
