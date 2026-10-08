import { z } from "zod";
import { MetaApiError, metaRequest, type MetaFetch } from "./client";
import { MetaId, MetaReverseCredentials } from "./reverse-meta";
import {
  MetaResultsUnavailableReason,
  type MetaDestinationResults,
  type MetaRangeMetric,
  type MetaScalarMetric,
} from "./results-meta";

export type MetaResultTarget =
  | {
      stream: "audience";
      audienceId: string;
      accountId: string;
      valueBased: boolean;
      managed?: boolean;
      ownershipMarker?: string;
      snapshot?: {
        sourceRows: number;
        uniqueMembers: number;
        projectedMembers?: number;
        excludedRows?: number;
      };
    }
  | { stream: "conversions"; pixelId: string };
const missing = { status: "unavailable", reason: "not-reported" } as const;
function scalar(raw: unknown, maximum = Infinity): MetaScalarMetric {
  if (raw === undefined || raw === null) return missing;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= maximum
    ? { status: "available", value: raw }
    : { status: "unavailable", reason: "invalid-response" };
}
const code = z.object({ code: z.number().int().nonnegative() }).nullish();

/** Current target-wide reporting, never delivery evidence. GET only; no payloads or raw diagnostics returned. */
export async function readMetaResults(
  credentials: unknown,
  target: MetaResultTarget,
  request: MetaFetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(20_000)
): Promise<MetaDestinationResults> {
  const observedAt = new Date().toISOString();
  try {
    const { accessToken } = MetaReverseCredentials.parse(credentials);
    if (target.stream === "audience") {
      const audienceId = MetaId.parse(target.audienceId),
        accountId = MetaId.parse(target.accountId);
      const data = z
        .object({
          id: MetaId,
          account_id: MetaId,
          subtype: z.string(),
          is_value_based: z.boolean().default(false),
          approximate_count_lower_bound: z.unknown().optional(),
          approximate_count_upper_bound: z.unknown().optional(),
          operation_status: code,
          delivery_status: code,
          description: z.string().optional(),
        })
        .parse(
          await metaRequest(
            request,
            accessToken,
            signal,
            `${audienceId}?fields=id,account_id,subtype,is_value_based,approximate_count_lower_bound,approximate_count_upper_bound,operation_status,delivery_status,description`
          )
        );
      if (
        data.id !== audienceId ||
        data.account_id !== accountId ||
        data.subtype !== "CUSTOM" ||
        data.is_value_based !== target.valueBased ||
        (target.ownershipMarker && data.description !== target.ownershipMarker)
      )
        return {
          kind: "unavailable",
          observedAt,
          reason: "target-access",
          message:
            "The audience no longer matches this sync's account or customer-list type. Check the target in Ads Manager.",
        };
      const lo = data.approximate_count_lower_bound,
        hi = data.approximate_count_upper_bound;
      let size: MetaRangeMetric = missing;
      if (lo === -1 || hi === -1) size = { status: "unavailable", reason: "privacy-limited" };
      else if (lo != null && hi != null)
        size =
          typeof lo === "number" &&
          typeof hi === "number" &&
          Number.isSafeInteger(lo) &&
          Number.isSafeInteger(hi) &&
          lo >= 0 &&
          hi >= lo
            ? { status: "available", lower: lo, upper: hi }
            : { status: "unavailable", reason: "invalid-response" };
      let matchRate: MetaRangeMetric = {
        status: "unavailable",
        reason: target.managed ? "no-snapshot" : "not-eligible",
      };
      const snapshot = target.snapshot;
      if (snapshot) {
        if (!snapshot.sourceRows) matchRate = { status: "unavailable", reason: "empty-snapshot" };
        else if (snapshot.projectedMembers === undefined || snapshot.excludedRows === undefined)
          matchRate = { status: "unavailable", reason: "no-snapshot" };
        else if (
          snapshot.excludedRows !== 0 ||
          snapshot.projectedMembers !== snapshot.sourceRows ||
          snapshot.uniqueMembers !== snapshot.projectedMembers
        )
          matchRate = { status: "unavailable", reason: "not-eligible" };
        else if (data.operation_status?.code !== 200) matchRate = { status: "unavailable", reason: "processing" };
        else if (size.status === "unavailable") matchRate = size;
        // Small audience estimates are privacy-threshold placeholders, not a reliable matched count.
        else if (size.upper <= 1000) matchRate = { status: "unavailable", reason: "privacy-limited" };
        else if (size.upper > snapshot.sourceRows) matchRate = { status: "unavailable", reason: "processing" };
        else
          matchRate = {
            status: "available",
            lower: (size.lower / snapshot.sourceRows) * 100,
            upper: (size.upper / snapshot.sourceRows) * 100,
          };
      }
      return {
        kind: "audience",
        observedAt,
        targetId: audienceId,
        size,
        matchRate,
        ...(snapshot && snapshot.sourceRows > 0 ? { denominatorRows: snapshot.sourceRows } : {}),
        ...(data.operation_status ? { operationCode: data.operation_status.code } : {}),
        ...(data.delivery_status ? { deliveryCode: data.delivery_status.code } : {}),
      };
    }
    const pixelId = MetaId.parse(target.pixelId);
    const data = z
      .object({
        web: z
          .array(
            z.object({
              event_name: z.string().min(1).max(256),
              event_match_quality: z.object({ composite_score: z.unknown().optional() }).nullish(),
              acr: z.object({ percentage: z.unknown().optional() }).nullish(),
            })
          )
          .max(1000),
      })
      .parse(
        await metaRequest(
          request,
          accessToken,
          signal,
          `dataset_quality?${new URLSearchParams({
            dataset_id: pixelId,
            fields: "web{event_name,event_match_quality{composite_score},acr{percentage}}",
          })}`
        )
      );
    return {
      kind: "conversions",
      observedAt,
      targetId: pixelId,
      events: data.web.map(event => ({
        eventName: event.event_name,
        emq: scalar(event.event_match_quality?.composite_score, 10),
        acr: scalar(event.acr?.percentage),
      })),
    };
  } catch (error) {
    let reason: z.infer<typeof MetaResultsUnavailableReason> =
      error instanceof z.ZodError ? "invalid-response" : "temporarily-unavailable";
    let message = "Meta results could not be read. Retry later; delivery and saved state are unaffected.";
    if (error instanceof MetaApiError) {
      if (error.code === 190) {
        reason = "credentials";
        message = "The Meta token is invalid or expired. Reconnect the destination.";
      } else if ([10, 200].includes(error.code ?? 0) || error.status === 403) {
        reason = "permissions";
        message =
          target.stream === "conversions"
            ? "Meta denied access to quality metrics. Grant the token's system user Use events dataset access and ads_read plus ads_management or business_management, or opt in to Dataset Quality API access in Events Manager. Delivery permission alone does not guarantee reporting access."
            : "Meta denied audience reporting access. Assign the ad account to the token's system user and grant ads_read or ads_management.";
      } else if (
        error.transient ||
        error.status === 429 ||
        error.status >= 500 ||
        [4, 17, 32, 613].includes(error.code ?? 0)
      ) {
        reason = "temporarily-unavailable";
        message = "Meta reporting is temporarily unavailable or rate limited. Refresh later.";
      } else {
        reason = "target-access";
        message =
          "Meta could not read this target's results. Check its ID and reporting permissions; for older conversion tokens, enable Dataset Quality API access in Events Manager.";
      }
    } else if (error instanceof z.ZodError && !MetaReverseCredentials.safeParse(credentials).success) {
      reason = "credentials";
      message = "Configure the destination's Meta access token to read results.";
    }
    return { kind: "unavailable", observedAt, reason, message };
  }
}
