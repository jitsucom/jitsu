import { describe, expect, it } from "vitest";
import { canUseCustomDomains, canUseIdentityStitching } from "../../lib/shared/plan-features";
import { noRestrictions } from "../../lib/schema";

describe("canUseCustomDomains", () => {
  it("denies free and allows the paid self-service tiers", () => {
    expect(canUseCustomDomains({ planId: "free" })).toBe(false);
    expect(canUseCustomDomains({ planId: "business" })).toBe(true);
    expect(canUseCustomDomains({ planId: "enterprise" })).toBe(true);
  });

  // Only "free" is denied, so a negotiated contract keeps the feature whatever
  // plan id it arrives under — the same regression canUseIdentityStitching
  // guards against, reached from the other direction.
  it("allows a negotiated contract whichever plan id it arrives under", () => {
    expect(canUseCustomDomains({ planId: "$custom", customBilling: true })).toBe(true);
    expect(canUseCustomDomains({ planId: "business", custom: true })).toBe(true);
    expect(canUseCustomDomains({ planId: "$admin" })).toBe(true);
    expect(canUseCustomDomains({ planId: "self-hosted" })).toBe(true);
  });

  it("allows workspaces with no billing at all (self-hosted, billing disabled)", () => {
    expect(canUseCustomDomains(undefined)).toBe(true);
    expect(canUseCustomDomains(null)).toBe(true);
  });

  it("lets an explicit plan flag override the plan id in both directions", () => {
    expect(canUseCustomDomains({ planId: "free", customDomainsEnabled: true })).toBe(true);
    expect(canUseCustomDomains({ planId: "enterprise", customDomainsEnabled: false })).toBe(false);
  });

  // The per-workspace `misc` grant predates this gate and is checked above the
  // plan, so it survives an explicit plan-level denial.
  it("honours the per-workspace misc grant over an explicit plan denial", () => {
    expect(canUseCustomDomains({ planId: "free", customDomainsEnabled: false }, ["misc"])).toBe(true);
    expect(canUseCustomDomains({ planId: "free" }, ["misc"])).toBe(true);
    expect(canUseCustomDomains({ planId: "free" }, ["syncs"])).toBe(false);
  });

  // ee-api reports planId "free" for more than the Free plan: a subscription in
  // any status other than active/past_due, and a custom contract dated in the
  // future, both resolve to it. The intended policy is that access starts when
  // the customer is billed.
  //
  // Read the second assertion narrowly. It shows the resolver honours an
  // explicit grant *if one arrives* — it does not show that one can arrive on
  // this path. It cannot today: the ee-api early return that sets
  // futureSubscriptionDate drops customSettings, so no *billing* grant reaches
  // the console for a not-yet-started contract. That gap is in billing. The
  // misc workspace grant is a separate route and still works — see the misc
  // test above, which does not go through billing at all.
  it("denies a contract that has not started; honours an explicit grant if one reaches it", () => {
    const futureContract = { planId: "free", futureSubscriptionDate: "2027-01-01T00:00:00.000Z" };
    expect(canUseCustomDomains(futureContract)).toBe(false);
    expect(canUseCustomDomains({ ...futureContract, customDomainsEnabled: true })).toBe(true);
  });

  it("treats an absent plan id as free", () => {
    expect(canUseCustomDomains({})).toBe(false);
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
