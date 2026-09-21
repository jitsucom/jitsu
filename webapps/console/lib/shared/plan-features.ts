/**
 * Plan entitlements for custom domains and the Identity Stitching connection
 * function (JITSU-228). Shared by the browser and the server on purpose: the
 * UI gate and the API gate resolve through the same two functions, so they
 * cannot drift apart and disagree about a workspace.
 *
 * Shape follows getBackupRetentionCapDays() in ./data-retention: an explicit
 * flag from the plan wins, and the plan id is only the fallback for plans that
 * predate the flag. The argument is structural rather than BillingSettings to
 * keep this importable from both sides without a cycle through lib/schema.
 */

/** The function id the connection editor writes for the Identity Stitching toggle. */
export const IDENTITY_STITCHING_FUNCTION_ID = "builtin.transformation.user-recognition";

/** True when a connection's data enables the Identity Stitching function. */
export function hasIdentityStitching(data: any): boolean {
  const functions = data?.functions;
  return Array.isArray(functions) && functions.some((f: any) => f?.functionId === IDENTITY_STITCHING_FUNCTION_ID);
}

/** The subset of BillingSettings these gates read. */
export type PlanFeatureFacts = {
  planId?: string;
  /** Negotiated plan from Stripe metadata. */
  custom?: boolean;
  /** Negotiated plan billed outside Stripe — ee-api reports planId "$custom". */
  customBilling?: boolean;
  customDomainsEnabled?: boolean;
  identityStitchingEnabled?: boolean;
};

/**
 * Plan ids that are definitely a self-service tier. Anything else — "enterprise",
 * "$custom" (a negotiated contract on custom billing), "$admin" (noRestrictions),
 * "self-hosted" — is not, and must not be denied by a fallback.
 *
 * This list is the reason neither resolver tests `planId === "enterprise"`.
 * ee-api sets planId "$custom" for every customBilling workspace
 * (jitsu-cloud-billing/lib/stripe.ts), which is exactly how a negotiated
 * enterprise contract arrives, so an equality test would switch the feature off
 * for the customers paying most for it.
 */
const SELF_SERVICE_PLAN_IDS = ["free", "business"];

/** A negotiated plan, by either of the two flags ee-api can set for one. */
function isNegotiatedPlan(billing: PlanFeatureFacts): boolean {
  return !!(billing.custom || billing.customBilling);
}

/**
 * Custom domains on sites — Business and Enterprise, not Free.
 *
 * Absent billing (self-hosted, or billing disabled) is allowed: there are no
 * plans to gate on. Note that a Stripe subscription in any status other than
 * `active`/`past_due` resolves to planId "free" in ee-api's getActivePlan — the
 * codebase has no trial support today, but if a trial is ever set from the
 * Stripe dashboard, that workspace reads as free and loses its domain here.
 */
export function canUseCustomDomains(billing: PlanFeatureFacts | null | undefined): boolean {
  if (!billing) {
    return true;
  }
  if (typeof billing.customDomainsEnabled === "boolean") {
    return billing.customDomainsEnabled;
  }
  return billing.planId !== "free";
}

/**
 * The Identity Stitching connection function — Enterprise only.
 *
 * The fallback denies only the known self-service tiers instead of allowing
 * only "enterprise", so a negotiated contract keeps the feature whichever plan
 * id it arrives under. Setting identityStitchingEnabled on the plan (or on a
 * workspace's customSettings) overrides the fallback in either direction.
 */
export function canUseIdentityStitching(billing: PlanFeatureFacts | null | undefined): boolean {
  if (!billing) {
    return true;
  }
  if (typeof billing.identityStitchingEnabled === "boolean") {
    return billing.identityStitchingEnabled;
  }
  if (isNegotiatedPlan(billing)) {
    return true;
  }
  return !SELF_SERVICE_PLAN_IDS.includes(billing.planId ?? "free");
}
