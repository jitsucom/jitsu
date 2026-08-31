import { describe, expect, it } from "vitest";
import { billingPeriod } from "../../components/Billing/billing-period";
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
