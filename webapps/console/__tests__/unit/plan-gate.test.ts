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
const WS = { id: "ws1" };
/** A workspace carrying the operator `misc` flag, which must not matter here. */
const WS_MISC = { id: "ws1", featuresEnabled: ["misc"] };
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
  it("refuses a domain added on the free plan once the flag is set", async () => {
    onPlan("free", { customDomainsEnabled: false });
    await expect(
      assertCustomDomainsAllowed(user, WS, "stream", { domains: ["new.com"] }, { domains: [] })
    ).rejects.toMatchObject({ status: 403 });
  });

  // The plan id alone now denies free — no flag required. This is the server
  // half of the gate, so it is what an API token hits.
  it("refuses a domain added on free with no flag on the plan", async () => {
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
    onPlan("free", { customDomainsEnabled: false });
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
  // `misc` is an operator flag with no bearing on this gate: a Free workspace
  // carrying it is refused like any other Free workspace, and billing is asked.
  it("ignores the `misc` workspace flag — Free is refused with or without it", async () => {
    onPlan("free");
    await expect(
      assertCustomDomainsAllowed(user, WS_MISC as any, "stream", { domains: ["new.com"] }, { domains: [] })
    ).rejects.toMatchObject({ status: 403 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

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
    await expect(assertIdentityStitchingAllowed(user, WS.id, on, off)).rejects.toMatchObject({ status: 403 });
  });

  // "starter" is the Business plan's machine id (renamed, id kept), so this is
  // the plan a real Business workspace is on.
  it("refuses turning it on for the Business plan under its real id, starter", async () => {
    onPlan("starter");
    await expect(assertIdentityStitchingAllowed(user, WS.id, on, off)).rejects.toMatchObject({ status: 403 });
  });

  it("allows turning it on for enterprise, and for a negotiated contract on $custom", async () => {
    onPlan("enterprise");
    await expect(assertIdentityStitchingAllowed(user, WS.id, on, off)).resolves.toBeUndefined();
    onPlan("$custom", { customBilling: true });
    await expect(assertIdentityStitchingAllowed(user, WS.id, on, off)).resolves.toBeUndefined();
  });

  it("lets a connection that already has it be re-saved, with no billing call", async () => {
    onPlan("business");
    await expect(assertIdentityStitchingAllowed(user, WS.id, on, on)).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("always allows turning it off", async () => {
    onPlan("free");
    await expect(assertIdentityStitchingAllowed(user, WS.id, off, on)).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
