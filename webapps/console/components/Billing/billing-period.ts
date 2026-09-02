import { BillingSettings } from "../../lib/schema";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

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

export type ChargeCadence = {
  /** Unit for a price label: "$X /month", "/quarter", "/year", "/6 months". */
  per: string;
  /** Adverb for copy: "billed monthly" / "quarterly" / "annually" / "every 6 months". */
  billed: string;
};

/**
 * How often a Stripe price charges: its `recurring.interval` times
 * `interval_count`. An annual commitment is often invoiced in installments (a
 * quarterly price on a plan metered yearly), so the charge cadence and the
 * metering interval are independent and must be labelled separately.
 */
export function chargeCadence(interval: "month" | "year", count: number = 1): ChargeCadence {
  if (interval === "year") {
    return count === 1
      ? { per: "year", billed: "annually" }
      : { per: `${count} years`, billed: `every ${count} years` };
  }
  switch (count) {
    case 1:
      return { per: "month", billed: "monthly" };
    case 3:
      return { per: "quarter", billed: "quarterly" };
    case 12:
      return { per: "year", billed: "annually" };
    default:
      return { per: `${count} months`, billed: `every ${count} months` };
  }
}

export type SyncQuotaWindow = { start: Date; end: Date };

/**
 * Window the sync quota is metered over.
 *
 * `dailyActiveSyncs` is a monthly limit with no annual terms (the billing
 * service keeps it monthly-defined on annual deals), so an annual plan must not
 * count a whole contract year of distinct syncs against it — a customer who
 * stays within a monthly limit of 3 but rotates syncs through the year would
 * be shown over quota and warned of an overage. On an annual plan the window is
 * the contract month containing `now`, anchored on the period start's day of
 * month and time of day exactly as a monthly subscription on the same anchor
 * would bill. Every anchor is derived from the period start, so a day-31 anchor
 * clamps to the end of shorter months without windows overlapping.
 *
 * Monthly plans keep their billing period and the free plan keeps the UTC
 * calendar month — both unchanged.
 */
export function syncQuotaWindow(settings: BillingSettings, now: Date = new Date()): SyncQuotaWindow {
  const period = settings.currentPeriod;
  if (!period) {
    return {
      start: dayjs(now).utc().startOf("month").toDate(),
      end: dayjs(now).utc().endOf("month").add(-1, "millisecond").toDate(),
    };
  }
  if (billingPeriod(settings).interval !== "year") {
    return { start: new Date(period.start), end: new Date(period.end) };
  }
  const anchor = dayjs.utc(period.start);
  const current = dayjs.utc(now);
  let months = (current.year() - anchor.year()) * 12 + (current.month() - anchor.month());
  if (anchor.add(months, "month").isAfter(current)) {
    months -= 1;
  }
  // The billing API never reports a period that hasn't started (a future-dated
  // deal comes back as the free plan with no period), but should it ever, the
  // first contract month is the window — never the month before the contract.
  months = Math.max(0, months);
  return { start: anchor.add(months, "month").toDate(), end: anchor.add(months + 1, "month").toDate() };
}
