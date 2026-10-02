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

/**
 * Confirmation shown before switching Identity Stitching off on a plan that
 * cannot switch it back on. Turning it on is refused on Save below Enterprise,
 * so on such a plan turning it off is one-way. Says only that — nothing about
 * what happens to data already stitched.
 */
export const IDENTITY_STITCHING_OFF_WARNING =
  "Turn off Identity Stitching? It's available on the Enterprise plan only, so you won't be able to turn it back on unless you upgrade. Contact sales to re-enable it.";

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
  /**
   * Set by ee-api when a custom contract is dated in the future, alongside
   * `planId: "free"`. **Deliberately not consulted by either resolver.** It
   * records that a contract is scheduled, not what it entitles, and the early
   * return that sets it drops `customSettings` — so granting from it would
   * override an explicit `false` that never reached us. Note the consequence:
   * because that same early return drops `customSettings`, an explicit grant
   * cannot reach this resolver on that path either. Present here so the shape
   * is honest about what billing sends.
   */
  futureSubscriptionDate?: string;
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
 *
 * **"starter" is the Business plan.** The product was renamed to Business but its
 * machine id stayed "starter" (jitsu-cloud-billing lib/migration/savings.ts), so
 * that is the id a Business workspace actually arrives under. Leaving it off this
 * list made it read as an unrecognised plan, and unrecognised plans are allowed —
 * which switched Identity Stitching on for Business. "business" stays listed in
 * case an id by that name is ever issued. A new self-service plan id must be added
 * here, or it is allowed by default.
 */
const SELF_SERVICE_PLAN_IDS = ["free", "starter", "business"];

/** The only plan id custom domains are denied on. */
const FREE_PLAN_ID = "free";

/** A negotiated plan, by either of the two flags ee-api can set for one. */
function isNegotiatedPlan(billing: PlanFeatureFacts): boolean {
  return !!(billing.custom || billing.customBilling);
}

/**
 * Custom domains on sites — Business and Enterprise, not Free.
 *
 * Precedence, highest first: an explicit `customDomainsEnabled` on the plan or
 * the workspace's billing `customSettings`, then the plan id. Only "free" is
 * denied — Business, Enterprise, "$custom", "$admin" and self-hosted all fall
 * through to allowed, so a negotiated contract keeps the feature whatever plan
 * id it arrives under.
 *
 * **Nothing about the workspace record is consulted.** `featuresEnabled` — and
 * in particular the operator `misc` flag, which means something else entirely —
 * has no effect on this decision, here or in the server gates. An earlier
 * version honoured `misc` as an override, which let a Free workspace add domains
 * on the strength of an unrelated flag. The only way to grant the feature
 * without changing the plan is the explicit `customDomainsEnabled` above.
 *
 * **Deriving denial from the plan id is deliberate, and it replaces an earlier
 * design that shipped this gate inactive.** That version allowed whenever no
 * flag was set, so enforcement waited on `customDomainsEnabled: false` being
 * added to the Free plan's Stripe plan_data. That route does not reach a
 * workspace with no qualifying subscription: ee-api falls back to a bare
 * `{ planId: "free" }` carrying no plan metadata (jitsu-cloud-billing
 * lib/stripe.ts), which is most of the Free tier. The flag-only design could
 * therefore never have been switched on for the population it was aimed at.
 *
 * Enforcement must land together with the pricing page change (websites #75),
 * which removes "Custom domains" from the Free tier. Until that ships the
 * product would refuse something the page still advertises.
 *
 * **What reads as "free" here is wider than the Free plan.** Verified in
 * jitsu-cloud-billing: getActivePlan returns a product only for an
 * `active`/`past_due` subscription carrying the current object_tag, and a
 * custom contract dated in the future returns `planId: "free"` before its start
 * date. Both therefore resolve to denied.
 *
 * The *intended policy* behind accepting that is access starting when the
 * customer is billed, with early or trial access granted explicitly. What is
 * *verified* about that escape hatch is narrower, and the difference matters:
 * an explicit `customDomainsEnabled` is honoured whenever it reaches this
 * resolver, which it does on the ordinary path because ee-api spreads
 * `customSettings` over the plan. It does **not** reach here for a contract
 * dated in the future — that early return builds its own object and drops
 * `customSettings`, `noRestrictions` and the negotiated markers — so the
 * *billing-flag* route to early access is unavailable for a not-yet-started
 * contract. Fixing that belongs in ee-api, not here. There is deliberately no
 * workspace-level escape hatch outside billing for either Custom Domains or
 * Identity Stitching.
 */
export function canUseCustomDomains(billing: PlanFeatureFacts | null | undefined): boolean {
  if (!billing) {
    return true;
  }
  if (typeof billing.customDomainsEnabled === "boolean") {
    return billing.customDomainsEnabled;
  }
  return (billing.planId ?? "free") !== FREE_PLAN_ID;
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
