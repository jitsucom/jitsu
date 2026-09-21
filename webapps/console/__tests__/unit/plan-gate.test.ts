import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("juava", async importOriginal => {
  const actual = await importOriginal<typeof import("juava")>();
  return { ...actual, rpc: (...args: any[]) => rpc(...args) };
});

vi.mock("../../lib/server/ee", () => ({
  isEEAvailable: () => true,
  getEeConnection: () => ({ host: "https://ee.test/" }),
  serviceTokenHeaders: () => ({}),
  eeAuthHeadersOrServiceToken: () => ({}),
}));

const { assertCustomDomainsAllowed, assertIdentityStitchingAllowed, domainsOf, hasIdentityStitching } = await import(
  "../../lib/server/plan-gate"
);

const user = { email: "a@b.c" } as any;
const WS = "ws1";
const onPlan = (planId: string, extra: Record<string, any> = {}) =>
  rpc.mockResolvedValue({ ok: true, subscriptionStatus: { planId, ...extra } });

beforeEach(() => rpc.mockReset());

describe("domainsOf", () => {
  it("normalises and reads both shapes that hold a custom domain", () => {
    expect(domainsOf("stream", { domains: [" Foo.COM ", "", "bar.com"] })).toEqual(["foo.com", "bar.com"]);
    expect(domainsOf("domain", { name: " Baz.COM " })).toEqual(["baz.com"]);
    expect(domainsOf("stream", {})).toEqual([]);
    expect(domainsOf("destination", { domains: ["x.com"] })).toEqual([]);
  });
});

describe("hasIdentityStitching", () => {
  it("detects the builtin function id", () => {
    expect(hasIdentityStitching({ functions: [{ functionId: "builtin.transformation.user-recognition" }] })).toBe(true);
    expect(hasIdentityStitching({ functions: [{ functionId: "other" }] })).toBe(false);
    expect(hasIdentityStitching({})).toBe(false);
    expect(hasIdentityStitching(undefined)).toBe(false);
  });
});

describe("assertCustomDomainsAllowed", () => {
  it("refuses a domain added on the free plan", async () => {
    onPlan("free");
    await expect(
      assertCustomDomainsAllowed(user, WS, "stream", { domains: ["new.com"] }, { domains: [] })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows a domain added on a paid plan", async () => {
    onPlan("business");
    await expect(
      assertCustomDomainsAllowed(user, WS, "stream", { domains: ["new.com"] }, { domains: [] })
    ).resolves.toBeUndefined();
  });

  // The grandfathering guarantee: an existing domain stays editable on a plan
  // that could no longer add it, and the save costs no billing round-trip.
  it("lets a free workspace keep and re-save a domain it already had", async () => {
    onPlan("free");
    await expect(
      assertCustomDomainsAllowed(
        user,
        WS,
        "stream",
        { domains: ["old.com"], name: "renamed" },
        { domains: ["old.com"] }
      )
    ).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses adding a second domain alongside a grandfathered one", async () => {
    onPlan("free");
    await expect(
      assertCustomDomainsAllowed(user, WS, "stream", { domains: ["old.com", "new.com"] }, { domains: ["old.com"] })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not consult billing for a save that touches no domain", async () => {
    onPlan("free");
    await expect(assertCustomDomainsAllowed(user, WS, "stream", { name: "x" }, { name: "y" })).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores types that cannot hold a domain", async () => {
    onPlan("free");
    await expect(assertCustomDomainsAllowed(user, WS, "destination", { domains: ["x.com"] })).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  // fetchPlan wraps the call and the ok check in one try/catch, so this covers
  // a transport failure too. A mock that rejects is not used here: vitest
  // reports the stored rejected mock result as an unhandled error even though
  // the gate catches it.
  it("fails closed (503) when the plan cannot be verified", async () => {
    rpc.mockResolvedValue({ ok: false, error: "no such workspace" });
    await expect(
      assertCustomDomainsAllowed(user, WS, "stream", { domains: ["new.com"] }, { domains: [] })
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe("assertIdentityStitchingAllowed", () => {
  const on = { functions: [{ functionId: "builtin.transformation.user-recognition" }] };
  const off = { functions: [] };

  it("refuses turning it on below enterprise", async () => {
    onPlan("business");
    await expect(assertIdentityStitchingAllowed(user, WS, on, off)).rejects.toMatchObject({ status: 403 });
  });

  it("allows turning it on for enterprise, and for a negotiated contract on $custom", async () => {
    onPlan("enterprise");
    await expect(assertIdentityStitchingAllowed(user, WS, on, off)).resolves.toBeUndefined();
    onPlan("$custom", { customBilling: true });
    await expect(assertIdentityStitchingAllowed(user, WS, on, off)).resolves.toBeUndefined();
  });

  it("lets a connection that already has it be re-saved, with no billing call", async () => {
    onPlan("business");
    await expect(assertIdentityStitchingAllowed(user, WS, on, on)).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("always allows turning it off", async () => {
    onPlan("free");
    await expect(assertIdentityStitchingAllowed(user, WS, off, on)).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
