// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// JITSU-228. The gate logic is covered by plan-features/plan-gate; this covers
// the thing neither can: that the component actually renders the upgrade
// banner in place of the add-domain control, and that the per-workspace
// `misc` grant still lets a free workspace add one.

const state = vi.hoisted(() => ({
  billing: { enabled: true, loading: false, settings: {} as any },
  featuresEnabled: [] as string[],
}));

vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slug: "ws", featuresEnabled: state.featuresEnabled }),
}));
vi.mock("../../components/Billing/BillingProvider", () => ({ useBilling: () => state.billing }));
vi.mock("../../lib/useApi", () => ({ get: vi.fn() }));
vi.mock("../../lib/modal", () => ({ useAntdModal: () => ({}), getAntdModal: () => ({}) }));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn(), query: {} }) }));
vi.mock("../../components/Workspace/WLink", () => ({ WLink: ({ children }: any) => children }));
vi.mock("../../components/JitsuButton/JitsuButton", () => ({
  JitsuButton: ({ children }: any) => React.createElement("button", null, children),
  WJitsuButton: ({ children }: any) => React.createElement("button", null, children),
}));

const { DomainsEditor } = await import("../../components/DomainsEditor/DomainsEditor");

const renderEditor = () =>
  render(
    React.createElement(DomainsEditor as any, {
      context: "site",
      value: [],
      workspaceDomains: [],
      onChange: () => {},
    })
  );

beforeEach(() => {
  state.billing = { enabled: true, loading: false, settings: {} };
  state.featuresEnabled = [];
});
afterEach(cleanup);

const addControl = () => screen.queryByPlaceholderText("subdomain.mywebsite.com");
const banner = () => screen.queryByText(/Custom domains require a paid plan/i);

describe("DomainsEditor plan gate", () => {
  it("shows the upgrade banner and hides the add control when the plan denies", () => {
    state.billing.settings = { planId: "free", planName: "Free", customDomainsEnabled: false };
    renderEditor();
    expect(banner()).toBeTruthy();
    expect(addControl()).toBeNull();
  });

  it("shows the add control on a plan that allows", () => {
    state.billing.settings = { planId: "business" };
    renderEditor();
    expect(banner()).toBeNull();
    expect(addControl()).toBeTruthy();
  });

  // The plan id alone denies free, so the upgrade banner shows and the add
  // control is withheld without any flag being set.
  it("shows the upgrade banner on free with no flag on the plan", () => {
    state.billing.settings = { planId: "free" };
    renderEditor();
    expect(banner()).toBeTruthy();
    expect(addControl()).toBeNull();
  });

  // Regression guard for the bug this gate originally shipped with.
  it("honours the per-workspace `misc` grant over an explicit plan denial", () => {
    state.billing.settings = { planId: "free", customDomainsEnabled: false };
    state.featuresEnabled = ["misc"];
    renderEditor();
    expect(banner()).toBeNull();
    expect(addControl()).toBeTruthy();
  });

  it("does not gate at all when billing is disabled (self-hosted)", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    renderEditor();
    expect(banner()).toBeNull();
    expect(addControl()).toBeTruthy();
  });
});
