/**
 * Share of the quota used, as a ratio (1 = 100%).
 *
 * A negative quota is the "unlimited" sentinel (`BillingManager` builds the
 * enterprise card with -1 and renders any non-positive plan quota as
 * "Unlimited"): nothing is ever exceeded, so the ratio is 0.
 *
 * A quota of exactly 0 is a misconfigured plan: the ratio is undefined, but any
 * positive usage is over the limit, so report it as exceeded (a finite value
 * above 1 — the progress bar clamps at 100% and the overage warning keys off
 * `> 1`) rather than as NaN/Infinity, and zero usage as 0.
 */
export function usagePercentage(usage: number, quota: number): number {
  if (quota > 0) {
    return usage / quota;
  }
  if (quota < 0) {
    return 0;
  }
  return usage > 0 ? 2 : 0;
}
