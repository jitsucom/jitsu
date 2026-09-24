// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

// JITSU-228. The gate logic is covered by plan-features/plan-gate; this covers
// the thing neither can: that the component actually renders the upgrade
// banner in place of the add-domain control, and that the per-workspace
// `misc` grant still lets a free workspace add one.

const state = vi.hoisted(() => ({
  billing: { enabled: true, loading: false, settings: {} as any },
  entitlements: { loading: false, customDomains: true as boolean | null, identityStitching: true as boolean | null },
  featuresEnabled: [] as string[],
  retry: vi.fn(),
}));

vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slug: "ws", featuresEnabled: state.featuresEnabled }),
}));
vi.mock("../../components/Billing/BillingProvider", () => ({ useBilling: () => state.billing }));
vi.mock("../../lib/entitlements", () => ({ useEntitlements: () => ({ ...state.entitlements, retry: state.retry }) }));
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
  state.entitlements = {
    loading: false,
    customDomains: true as boolean | null,
    identityStitching: true as boolean | null,
  };
  state.featuresEnabled = [];
});
afterEach(cleanup);

const addControl = () => screen.queryByPlaceholderText("subdomain.mywebsite.com");
const banner = () => screen.queryByText(/Custom domains require a paid plan/i);

describe("DomainsEditor plan gate", () => {
  it("shows the upgrade banner and hides the add control when the server denies", () => {
    state.entitlements.customDomains = false;
    renderEditor();
    expect(banner()).toBeTruthy();
    expect(addControl()).toBeNull();
  });

  it("shows the add control when the server allows", () => {
    state.entitlements.customDomains = true;
    renderEditor();
    expect(banner()).toBeNull();
    expect(addControl()).toBeTruthy();
  });

  // The regression this endpoint exists for. On an EE deployment without
  // Firebase — NextAuth or OIDC — appConfig.billingEnabled is false, so
  // useBilling() reports disabled and the old gate silently allowed everything
  // while the server refused the save. The gate must now follow the server's
  // answer and ignore browser billing availability entirely.
  it("gates on EE without Firebase, where browser billing is unavailable", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    state.entitlements.customDomains = false;
    renderEditor();
    expect(banner()).toBeTruthy();
    expect(addControl()).toBeNull();
  });

  it("allows an eligible workspace on EE without Firebase", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    state.entitlements.customDomains = true;
    renderEditor();
    expect(banner()).toBeNull();
    expect(addControl()).toBeTruthy();
  });

  // The misc grant and explicit flags are resolved server-side now, so from the
  // component's side they arrive as a plain allow. Their resolution is covered
  // in plan-features; what matters here is that an allow renders as an allow.
  it("shows the add control when an explicit grant makes the server allow", () => {
    state.featuresEnabled = ["misc"];
    state.entitlements.customDomains = true;
    renderEditor();
    expect(banner()).toBeNull();
    expect(addControl()).toBeTruthy();
  });

  // No EE at all: resolveEntitlements returns allow-all, so self-hosted is
  // ungated exactly as before.
  it("does not gate at all when EE is unavailable (self-hosted)", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    state.entitlements = {
      loading: false,
      customDomains: true as boolean | null,
      identityStitching: true as boolean | null,
    };
    renderEditor();
    expect(banner()).toBeNull();
    expect(addControl()).toBeTruthy();
  });

  // Never flash an upgrade prompt at someone who may be entitled.
  it("withholds new domain controls while the lookup is in flight", () => {
    state.entitlements = { loading: true, customDomains: null, identityStitching: null };
    renderEditor();
    expect(banner()).toBeNull();
    expect(addControl()).toBeNull();
    expect(screen.queryByText("Checking access…")).toBeTruthy();
  });
});

it("withholds adding on failure and offers retry without an upgrade prompt", () => {
  state.entitlements.customDomains = null;
  renderEditor();
  expect(addControl()).toBeNull();
  expect(banner()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.retry).toHaveBeenCalledTimes(1);
});
