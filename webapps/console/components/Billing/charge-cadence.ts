export type ChargeCadence = {
  /** Unit for a price label: "$X /month", "/quarter", "/year", "/6 months". */
  per: string;
  /** Adverb for copy: "billed monthly" / "quarterly" / "annually" / "every 6 months". */
  billed: string;
};

/**
 * How often a Stripe price charges: its `recurring.interval` times
 * `interval_count`. A committed contract is often invoiced in installments (a
 * quarterly price under a 12-month commitment), so the charge cadence is
 * labelled separately from the commitment term and from the monthly quota.
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

/**
 * Copy for a commitment term declared on a negotiated plan
 * (`commitmentInterval`, JITSU-200): "12-month commitment" for a year, nothing
 * for a month-to-month plan or when absent.
 */
export function commitmentLabel(commitmentInterval: string | null | undefined): string | undefined {
  return commitmentInterval === "year" ? "12-month commitment" : undefined;
}
