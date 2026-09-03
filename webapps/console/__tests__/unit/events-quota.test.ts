import { describe, expect, it } from "vitest";
import { monthlyEventsQuota } from "../../lib/events-quota";

describe("monthlyEventsQuota", () => {
  it("reads the legacy misspelt key", () => {
    expect(monthlyEventsQuota({ destinationEvensPerMonth: 200_000 })).toBe(200_000);
  });

  it("reads the correct key", () => {
    expect(monthlyEventsQuota({ destinationEventsPerMonth: 5_000_000 })).toBe(5_000_000);
  });

  it("prefers the correct key when both are present", () => {
    expect(monthlyEventsQuota({ destinationEventsPerMonth: 1, destinationEvensPerMonth: 2 })).toBe(1);
  });

  it("treats a quoted number as no quota, like the billing service does", () => {
    expect(monthlyEventsQuota({ destinationEventsPerMonth: "1000000" })).toBeUndefined();
    expect(monthlyEventsQuota({ destinationEvensPerMonth: "1000000" })).toBeUndefined();
  });

  it("is undefined when neither key is set or the value is not a finite number", () => {
    expect(monthlyEventsQuota({})).toBeUndefined();
    expect(monthlyEventsQuota(undefined)).toBeUndefined();
    expect(monthlyEventsQuota({ destinationEvensPerMonth: null })).toBeUndefined();
    expect(monthlyEventsQuota({ destinationEvensPerMonth: Number.NaN })).toBeUndefined();
  });
});
