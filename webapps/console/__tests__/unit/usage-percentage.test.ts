import { describe, expect, it } from "vitest";
import { usagePercentage } from "../../components/Billing/usage-percentage";

describe("usagePercentage", () => {
  it("is the plain ratio for a positive quota", () => {
    expect(usagePercentage(50_000, 200_000)).toBe(0.25);
    expect(usagePercentage(300_000, 200_000)).toBe(1.5);
    expect(usagePercentage(0, 200_000)).toBe(0);
  });

  it("reports positive usage against a zero quota as exceeded, never NaN or Infinity", () => {
    const over = usagePercentage(1, 0);
    expect(Number.isFinite(over)).toBe(true);
    expect(over).toBeGreaterThan(1);
  });

  it("reports zero usage against a zero quota as nothing used", () => {
    expect(usagePercentage(0, 0)).toBe(0);
  });

  it("never reports usage against a negative (unlimited) quota as exceeded", () => {
    expect(usagePercentage(0, -1)).toBe(0);
    expect(usagePercentage(1_000_000_000, -1)).toBe(0);
  });
});
