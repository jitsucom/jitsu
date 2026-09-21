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

/**
 * Per-workspace grant that predates this gate: an operator adds "misc" to a
 * workspace's featuresEnabled to give that one customer workspace domains
 * regardless of plan. settings/domains.tsx has honoured it since before
 * JITSU-228, so the gate must too or those workspaces break.
 */
export const WORKSPACE_DOMAINS_FEATURE = "misc";

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
 * **This gate ships dark, and deliberately behaves differently from
 * canUseIdentityStitching below.** A plan carrying no explicit flag is
 * allowed, so merging this code changes nothing for anyone. Enforcement begins
 * when `customDomainsEnabled: false` is set on the free plan's Stripe
 * plan_data — a data operation, not a deploy.
 *
 * The reason is that the public pricing page currently advertises custom
 * domains on the Free tier. Deriving "deny" from the plan id would block Free
 * users the moment this merged, while the page still promised the feature —
 * which is the same contradiction JITSU-228 exists to remove, pointed the
 * other way. Tying enforcement to a flag lets it switch on in the same hour
 * the pricing page changes, so the two can never disagree.
 *
 * The cost of this choice is that if nobody ever sets the flag, nothing is
 * gated and the ticket looks done. That is a deliberate trade, not an
 * oversight — see the PR body.
 *
 * Note also that a Stripe subscription in any status other than
 * `active`/`past_due` resolves to planId "free" in ee-api's getActivePlan. The
 * codebase has no trial support today, but if a trial is ever set from the
 * Stripe dashboard that workspace reads as free — one more reason not to
 * derive denial from the plan id here.
 */
export function canUseCustomDomains(
  billing: PlanFeatureFacts | null | undefined,
  featuresEnabled?: readonly string[] | null
): boolean {
  // Checked before the plan: the flag exists precisely to override it, and an
  // explicit customDomainsEnabled:false on the plan must not revoke a grant
  // someone made by hand for one workspace.
  if ((featuresEnabled ?? []).includes(WORKSPACE_DOMAINS_FEATURE)) {
    return true;
  }
  if (!billing) {
    return true;
  }
  if (typeof billing.customDomainsEnabled === "boolean") {
    return billing.customDomainsEnabled;
  }
  return true;
}

/**
 * The Identity Stitching connection function — Enterprise only.
 *
 * The fallback denies only the known self-service tiers instead of allowing
 * only "enterprise", so a negotiated contract keeps the feature whichever plan
 * id it arrives under. Setting identityStitchingEnabled on the plan (or on a
 * workspace's customSettings) overrides the fallback in either direction.
 *
 * Unlike custom domains above, this one enforces as soon as it ships. Identity
 * Stitching does not appear on the public pricing page at all, so there is no
 * published promise for it to contradict, and grandfathering already protects
 * anyone using it today.
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
