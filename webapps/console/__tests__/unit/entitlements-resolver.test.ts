import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const ee = vi.hoisted(() => ({ available: true }));

vi.mock("juava", async importOriginal => {
  const actual = await importOriginal<typeof import("juava")>();
  return { ...actual, rpc: (...args: any[]) => rpc(...args) };
});

vi.mock("../../lib/server/ee", () => ({
  isEEAvailable: () => ee.available,
  getEeConnection: () => ({ host: "https://ee.test/" }),
  serviceTokenHeaders: () => ({}),
  eeAuthHeadersOrServiceToken: () => ({}),
}));

const { resolveEntitlements } = await import("../../lib/server/plan-gate");

const user = { email: "a@b.c" } as any;
const WS = { id: "ws1" };
/** A workspace carrying the operator `misc` flag, which must not matter here. */
const WS_MISC = { id: "ws1", featuresEnabled: ["misc"] };
const onPlan = (planId: string, extra: Record<string, any> = {}) =>
  rpc.mockResolvedValue({ ok: true, subscriptionStatus: { planId, ...extra } });
const billingDown = () => rpc.mockRejectedValue(new Error("ee-api down"));

beforeEach(() => {
  rpc.mockReset();
  ee.available = true;
});

// The resolver the browser reads through /api/:workspaceId/entitlements. It has
// to give the same answers as the assert* gates above — that is the entire
// point of it — and it has to distinguish "denied" from "could not tell".
describe("resolveEntitlements", () => {
  it("answers both from the plan", async () => {
    onPlan("free");
    expect(await resolveEntitlements(user, WS)).toEqual({ customDomains: false, identityStitching: false });
    onPlan("business");
    expect(await resolveEntitlements(user, WS)).toEqual({ customDomains: true, identityStitching: false });
    onPlan("enterprise");
    expect(await resolveEntitlements(user, WS)).toEqual({ customDomains: true, identityStitching: true });
  });

  it("honours an explicit flag in either direction", async () => {
    onPlan("free", { customDomainsEnabled: true });
    expect((await resolveEntitlements(user, WS)).customDomains).toBe(true);
    onPlan("enterprise", { identityStitchingEnabled: false });
    expect((await resolveEntitlements(user, WS)).identityStitching).toBe(false);
  });

  it("ignores the misc workspace flag — a Free workspace stays locked", async () => {
    onPlan("free");
    expect((await resolveEntitlements(user, WS_MISC as any)).customDomains).toBe(false);
    onPlan("free", { customDomainsEnabled: false });
    expect((await resolveEntitlements(user, WS_MISC as any)).customDomains).toBe(false);
  });

  // null is "unknown", never "denied" — the caller must not render an upgrade
  // prompt from it. The write gate still fails closed, so nothing is granted.
  it("reports unknown, not denied, when billing cannot be reached", async () => {
    billingDown();
    expect(await resolveEntitlements(user, WS)).toEqual({ customDomains: null, identityStitching: null });
  });
});

it("allows self-hosted without contacting billing", async () => {
  ee.available = false;
  expect(await resolveEntitlements(user, WS)).toEqual({ customDomains: true, identityStitching: true });
  expect(rpc).not.toHaveBeenCalled();
});
