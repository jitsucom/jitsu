import { describe, expect, it } from "vitest";
import { monthlyEventsQuota } from "../../lib/events-quota";

// These cases mirror the billing service's own resolution (jitsu-cloud-billing
// `planEventsQuota`, pinned there by test/plan-data.test.ts): the console must
// never report a quota the billing service is not metering, or miss one it is.
describe("monthlyEventsQuota", () => {
  it("reads the legacy misspelt key", () => {
    expect(monthlyEventsQuota({ destinationEvensPerMonth: 200_000 })).toBe(200_000);
  });

  it("reads the correct key", () => {
    expect(monthlyEventsQuota({ destinationEventsPerMonth: 5_000_000 })).toBe(5_000_000);
  });

  it("prefers the correct key when both hold a number, including an explicit 0", () => {
    expect(monthlyEventsQuota({ destinationEventsPerMonth: 1, destinationEvensPerMonth: 2 })).toBe(1);
    expect(monthlyEventsQuota({ destinationEventsPerMonth: 0, destinationEvensPerMonth: 5_000_000 })).toBe(0);
  });

  it("skips a preferred key that is not a real number and uses the legacy one", () => {
    expect(monthlyEventsQuota({ destinationEventsPerMonth: "1000000", destinationEvensPerMonth: 5_000_000 })).toBe(
      5_000_000
    );
    expect(monthlyEventsQuota({ destinationEventsPerMonth: null, destinationEvensPerMonth: 5_000_000 })).toBe(
      5_000_000
    );
  });

  it("treats a quoted number as no quota, like the billing service does", () => {
    expect(monthlyEventsQuota({ destinationEventsPerMonth: "1000000" })).toBeUndefined();
    expect(monthlyEventsQuota({ destinationEvensPerMonth: "1000000" })).toBeUndefined();
  });

  it("is undefined when neither key is set or neither is a finite number", () => {
    expect(monthlyEventsQuota({})).toBeUndefined();
    expect(monthlyEventsQuota(undefined)).toBeUndefined();
    expect(monthlyEventsQuota({ destinationEvensPerMonth: null })).toBeUndefined();
    expect(monthlyEventsQuota({ destinationEvensPerMonth: Number.NaN })).toBeUndefined();
  });
});
