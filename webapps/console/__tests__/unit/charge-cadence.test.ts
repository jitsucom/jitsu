import { describe, expect, it } from "vitest";
import { chargeCadence, commitmentLabel } from "../../components/Billing/charge-cadence";

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

describe("commitmentLabel", () => {
  it("names a yearly commitment and stays silent otherwise", () => {
    expect(commitmentLabel("year")).toBe("12-month commitment");
    expect(commitmentLabel("month")).toBeUndefined();
    expect(commitmentLabel(undefined)).toBeUndefined();
  });
});
