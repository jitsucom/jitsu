/**
 * Share of the quota used, as a ratio (1 = 100%). A quota of 0 is a
 * misconfigured plan: the ratio is undefined, but any positive usage is over
 * the limit, so report it as exceeded (a finite value above 1 — the progress
 * bar clamps at 100% and the overage warning keys off `> 1`) rather than as
 * NaN/Infinity, and zero usage as 0.
 */
export function usagePercentage(usage: number, quota: number): number {
  if (quota > 0) {
    return usage / quota;
  }
  return usage > 0 ? 2 : 0;
}
