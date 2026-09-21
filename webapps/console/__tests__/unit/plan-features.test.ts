import { describe, expect, it } from "vitest";
import { canUseCustomDomains, canUseIdentityStitching } from "../../lib/shared/plan-features";
import { noRestrictions } from "../../lib/schema";

describe("canUseCustomDomains", () => {
  // Ships dark: the plan id alone never denies. Enforcement arrives with the
  // flag, so this merges without contradicting the pricing page.
  it("allows every plan while no plan carries the flag", () => {
    expect(canUseCustomDomains({ planId: "free" })).toBe(true);
    expect(canUseCustomDomains({ planId: "business" })).toBe(true);
    expect(canUseCustomDomains({ planId: "enterprise" })).toBe(true);
  });

  it("denies free once the flag is set on the plan", () => {
    expect(canUseCustomDomains({ planId: "free", customDomainsEnabled: false })).toBe(false);
    expect(canUseCustomDomains({ planId: "business", customDomainsEnabled: true })).toBe(true);
  });

  it("allows workspaces with no billing at all (self-hosted, billing disabled)", () => {
    expect(canUseCustomDomains(undefined)).toBe(true);
    expect(canUseCustomDomains(null)).toBe(true);
    expect(canUseCustomDomains({ planId: "self-hosted" })).toBe(true);
    expect(canUseCustomDomains({ planId: "$admin" })).toBe(true);
  });

  it("lets an explicit plan flag override the plan id in both directions", () => {
    expect(canUseCustomDomains({ planId: "free", customDomainsEnabled: true })).toBe(true);
    expect(canUseCustomDomains({ planId: "enterprise", customDomainsEnabled: false })).toBe(false);
  });
});

describe("canUseIdentityStitching", () => {
  it("denies the self-service tiers and allows enterprise", () => {
    expect(canUseIdentityStitching({ planId: "free" })).toBe(false);
    expect(canUseIdentityStitching({ planId: "business" })).toBe(false);
    expect(canUseIdentityStitching({ planId: "enterprise" })).toBe(true);
  });

  // The regression this whole resolver exists to prevent: a negotiated
  // enterprise contract on custom billing arrives as planId "$custom", so
  // `planId === "enterprise"` would switch the feature off for the customers
  // paying most for it.
  it("allows a negotiated contract whichever plan id it arrives under", () => {
    expect(canUseIdentityStitching({ planId: "$custom", customBilling: true })).toBe(true);
    expect(canUseIdentityStitching({ planId: "business", custom: true })).toBe(true);
    expect(canUseIdentityStitching({ planId: "$admin" })).toBe(true);
    expect(canUseIdentityStitching({ planId: "self-hosted" })).toBe(true);
  });

  it("allows workspaces with no billing at all", () => {
    expect(canUseIdentityStitching(undefined)).toBe(true);
    expect(canUseIdentityStitching(null)).toBe(true);
  });

  it("lets an explicit plan flag override the fallback in both directions", () => {
    expect(canUseIdentityStitching({ planId: "business", identityStitchingEnabled: true })).toBe(true);
    expect(canUseIdentityStitching({ planId: "enterprise", identityStitchingEnabled: false })).toBe(false);
    // An explicit false beats the negotiated-plan allowance.
    expect(canUseIdentityStitching({ planId: "$custom", customBilling: true, identityStitchingEnabled: false })).toBe(
      false
    );
  });
});

describe("noRestrictions", () => {
  it("grants both features, so admin workspaces are unaffected by the gates", () => {
    expect(canUseCustomDomains(noRestrictions)).toBe(true);
    expect(canUseIdentityStitching(noRestrictions)).toBe(true);
  });
});
