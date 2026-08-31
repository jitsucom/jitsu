import { BillingSettings } from "../../lib/schema";

/**
 * How to read a workspace's quota and usage for its current billing period
 * (JITSU-200).
 *
 * Monthly plans meter against a per-month allowance; annual plans commit to a
 * volume for the whole contract year and meter against that single pool, which
 * only resets on the anniversary. Everything user-facing — the quota figure,
 * the progress bar, the overage copy — has to come from here rather than
 * reading `destinationEvensPerMonth` directly, or an annual workspace is shown
 * a twelfth of what it bought.
 */
export type BillingPeriod = {
  interval: "month" | "year";
  /** Included destination events for one full billing period. */
  eventsQuota: number;
  /** Adjective for quota copy: "monthly limit" / "annual limit". */
  adjective: "monthly" | "annual";
  /** Noun for period copy: "by the end of the month" / "... of the year". */
  noun: "month" | "year";
};

export function billingPeriod(settings: BillingSettings): BillingPeriod {
  const interval = settings.billingInterval ?? "month";
  return {
    interval,
    // A plan that predates annual pricing carries only the monthly field.
    eventsQuota: settings.destinationEventsPerPeriod ?? settings.destinationEvensPerMonth,
    adjective: interval === "year" ? "annual" : "monthly",
    noun: interval === "year" ? "year" : "month",
  };
}
