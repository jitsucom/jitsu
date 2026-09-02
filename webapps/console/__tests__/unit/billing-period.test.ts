import { describe, expect, it } from "vitest";
import { billingPeriod, chargeCadence, syncQuotaWindow } from "../../components/Billing/billing-period";
import { BillingSettings } from "../../lib/schema";

const settings = (over: Partial<BillingSettings> = {}): BillingSettings =>
  BillingSettings.parse({ planId: "test", ...over });

describe("billingPeriod", () => {
  it("defaults to the monthly allowance for a plan that predates annual pricing", () => {
    const period = billingPeriod(settings({ destinationEvensPerMonth: 5_000_000 }));
    expect(period).toEqual({
      interval: "month",
      eventsQuota: 5_000_000,
      adjective: "monthly",
      noun: "month",
    });
  });

  it("meters an annual plan against the committed annual volume, not the monthly tier", () => {
    const period = billingPeriod(
      settings({
        billingInterval: "year",
        destinationEvensPerMonth: 5_000_000,
        destinationEventsPerPeriod: 18_000_000_000,
      })
    );
    expect(period).toEqual({
      interval: "year",
      eventsQuota: 18_000_000_000,
      adjective: "annual",
      noun: "year",
    });
  });

  it("honours an explicit per-period quota on a monthly plan", () => {
    expect(billingPeriod(settings({ destinationEvensPerMonth: 1, destinationEventsPerPeriod: 42 })).eventsQuota).toBe(
      42
    );
  });

  it("falls back to the monthly allowance when an annual plan is missing its committed volume", () => {
    // A half-configured Stripe product must not silently meter against zero.
    const period = billingPeriod(settings({ billingInterval: "year", destinationEvensPerMonth: 5_000_000 }));
    expect(period.eventsQuota).toBe(5_000_000);
    expect(period.adjective).toBe("annual");
  });

  it("uses the free-plan default when nothing is configured", () => {
    expect(billingPeriod(settings()).eventsQuota).toBe(200_000);
  });
});

describe("chargeCadence", () => {
  it("labels the common Stripe cadences", () => {
    expect(chargeCadence("month")).toEqual({ per: "month", billed: "monthly" });
    expect(chargeCadence("month", 3)).toEqual({ per: "quarter", billed: "quarterly" });
    expect(chargeCadence("month", 12)).toEqual({ per: "year", billed: "annually" });
    expect(chargeCadence("year")).toEqual({ per: "year", billed: "annually" });
  });

  it("falls back to a count for unusual cadences", () => {
    expect(chargeCadence("month", 6)).toEqual({ per: "6 months", billed: "every 6 months" });
    expect(chargeCadence("year", 2)).toEqual({ per: "2 years", billed: "every 2 years" });
  });
});

describe("syncQuotaWindow", () => {
  const iso = (w: { start: Date; end: Date }) => ({ start: w.start.toISOString(), end: w.end.toISOString() });
  const annual = settings({
    billingInterval: "year",
    currentPeriod: { start: "2026-03-15T14:23:11.000Z", end: "2027-03-15T14:23:11.000Z" },
  });

  it("uses the UTC calendar month when the plan has no billing period (free plan)", () => {
    expect(iso(syncQuotaWindow(settings(), new Date("2026-08-31T12:00:00Z")))).toEqual({
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-08-31T23:59:59.998Z",
    });
  });

  it("keeps the billing period on a monthly plan", () => {
    const currentPeriod = { start: "2026-08-15T14:23:11.000Z", end: "2026-09-15T14:23:11.000Z" };
    expect(iso(syncQuotaWindow(settings({ currentPeriod }), new Date("2026-08-31T12:00:00Z")))).toEqual(currentPeriod);
  });

  it("meters an annual plan over the contract month containing now, not the whole year", () => {
    expect(iso(syncQuotaWindow(annual, new Date("2026-08-31T12:00:00Z")))).toEqual({
      start: "2026-08-15T14:23:11.000Z",
      end: "2026-09-15T14:23:11.000Z",
    });
    // before this month's anchor day: the window that opened last month is still running
    expect(iso(syncQuotaWindow(annual, new Date("2026-08-10T12:00:00Z")))).toEqual({
      start: "2026-07-15T14:23:11.000Z",
      end: "2026-08-15T14:23:11.000Z",
    });
    // on the anchor day but before the anchor time: same
    expect(iso(syncQuotaWindow(annual, new Date("2026-08-15T09:00:00Z")))).toEqual({
      start: "2026-07-15T14:23:11.000Z",
      end: "2026-08-15T14:23:11.000Z",
    });
  });

  it("lines the first and last contract months up with the annual period boundaries", () => {
    expect(iso(syncQuotaWindow(annual, new Date("2026-03-20T12:00:00Z")))).toEqual({
      start: "2026-03-15T14:23:11.000Z",
      end: "2026-04-15T14:23:11.000Z",
    });
    expect(iso(syncQuotaWindow(annual, new Date("2027-03-10T12:00:00Z")))).toEqual({
      start: "2027-02-15T14:23:11.000Z",
      end: "2027-03-15T14:23:11.000Z",
    });
  });

  it("clamps a day-31 anchor to shorter months without overlapping windows", () => {
    const jan31 = settings({
      billingInterval: "year",
      currentPeriod: { start: "2027-01-31T00:00:00.000Z", end: "2028-01-31T00:00:00.000Z" },
    });
    expect(iso(syncQuotaWindow(jan31, new Date("2027-02-20T12:00:00Z")))).toEqual({
      start: "2027-01-31T00:00:00.000Z",
      end: "2027-02-28T00:00:00.000Z",
    });
    expect(iso(syncQuotaWindow(jan31, new Date("2027-03-01T12:00:00Z")))).toEqual({
      start: "2027-02-28T00:00:00.000Z",
      end: "2027-03-31T00:00:00.000Z",
    });
  });
});
