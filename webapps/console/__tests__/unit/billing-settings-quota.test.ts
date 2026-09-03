import { describe, expect, it } from "vitest";
import { BillingSettings } from "../../lib/schema";

describe("BillingSettings events quota", () => {
  it("keeps a plan configured with the legacy key only", () => {
    expect(BillingSettings.parse({ destinationEvensPerMonth: 5_000_000 }).destinationEvensPerMonth).toBe(5_000_000);
  });

  it("reads a plan configured with the correct key only", () => {
    expect(BillingSettings.parse({ destinationEventsPerMonth: 5_000_000 }).destinationEvensPerMonth).toBe(5_000_000);
  });

  it("lets the correct key win when both are set", () => {
    const parsed = BillingSettings.parse({ destinationEventsPerMonth: 1_000_000, destinationEvensPerMonth: 5_000_000 });
    expect(parsed.destinationEvensPerMonth).toBe(1_000_000);
    expect(parsed.destinationEventsPerMonth).toBe(1_000_000);
  });

  it("skips a correct key that is not a real number and keeps the legacy quota", () => {
    expect(
      BillingSettings.parse({ destinationEventsPerMonth: "1000000", destinationEvensPerMonth: 5_000_000 })
        .destinationEvensPerMonth
    ).toBe(5_000_000);
  });

  it("falls back to the default when neither key holds a usable quota", () => {
    expect(BillingSettings.parse({}).destinationEvensPerMonth).toBe(200_000);
    expect(BillingSettings.parse({ destinationEventsPerMonth: "1000000" }).destinationEvensPerMonth).toBe(200_000);
  });

  it("keeps the unlimited sentinel", () => {
    expect(BillingSettings.parse({ destinationEvensPerMonth: -1 }).destinationEvensPerMonth).toBe(-1);
  });
});
