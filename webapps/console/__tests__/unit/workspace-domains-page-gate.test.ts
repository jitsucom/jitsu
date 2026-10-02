// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// JITSU-228. settings/domains.tsx gated free workspaces with its own inline
// plan test until this ticket pointed it at the server's entitlement verdict.
// This covers that the page follows that verdict alone — in particular that
// the operator `misc` flag, which the old inline test honoured, no longer
// opens the page for a workspace the server says is locked.

const state = vi.hoisted(() => ({
  billing: { enabled: true, loading: false, settings: {} as any },
  entitlements: { loading: false, customDomains: true, identityStitching: true },
  featuresEnabled: [] as string[],
  domains: [] as any[],
  apiLoading: false,
  apiError: false,
  retry: vi.fn(),
}));

vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slug: "ws", slugOrId: "ws", featuresEnabled: state.featuresEnabled }),
  useWorkspaceRole: () => ({ editEntities: true, deleteEntities: true }),
}));
vi.mock("../../components/Billing/BillingProvider", () => ({ useBilling: () => state.billing }));

vi.mock("../../components/PageLayout/WorkspacePageLayout", () => ({
  WorkspacePageLayout: ({ children }: any) => children,
}));
// Stubbed: the editor has its own gate test; here we only care which branch
// the page takes.
vi.mock("../../components/DomainsEditor/DomainsEditor", () => ({
  DomainsEditor: () => React.createElement("div", { "data-testid": "domains-editor" }),
}));
vi.mock("../../components/JitsuButton/JitsuButton", () => ({
  WJitsuButton: ({ children }: any) => React.createElement("button", null, children),
}));
vi.mock("../../components/GlobalLoader/GlobalLoader", () => ({
  LoadingAnimation: () => React.createElement("div", { "data-testid": "loading" }),
}));
vi.mock("../../lib/useApi", () => ({
  useConfigApi: () => ({ create: vi.fn(), del: vi.fn() }),
  useApi: () => {
    // Keep a real React hook in the actual useEntitlements call chain so a
    // loading-to-loaded rerender detects conditional hook ordering.
    React.useState(0);
    return {
      data: state.apiLoading || state.apiError ? undefined : state.entitlements,
      isLoading: state.apiLoading,
      isFetching: state.apiLoading,
      isError: state.apiError,
      refetch: state.retry,
    };
  },
}));
vi.mock("../../lib/store", () => ({
  useConfigObjectList: () => state.domains,
  useConfigObjectMutation: () => ({ mutateAsync: vi.fn() }),
}));

const WorkspaceDomains = (await import("../../pages/[workspaceId]/settings/domains")).default;

const renderPage = () => render(React.createElement(WorkspaceDomains as any));
const upgrade = () => screen.queryByText("Upgrade required");
const editor = () => screen.queryByTestId("domains-editor");

beforeEach(() => {
  state.billing = { enabled: true, loading: false, settings: {} };
  state.entitlements = { loading: false, customDomains: true, identityStitching: true };
  state.featuresEnabled = [];
  state.domains = [];
  state.apiLoading = false;
  state.apiError = false;
});
afterEach(cleanup);

describe("workspace domains page gate", () => {
  it("shows the upgrade dialog when the plan denies", () => {
    state.entitlements.customDomains = false;
    renderPage();
    expect(upgrade()).toBeTruthy();
    expect(editor()).toBeNull();
  });

  // `misc` is an operator flag with no meaning for this page.
  it("ignores the `misc` workspace flag — a locked workspace shows the upgrade prompt", () => {
    state.entitlements.customDomains = false;
    state.featuresEnabled = ["misc"];
    renderPage();
    expect(upgrade()).toBeTruthy();
    expect(editor()).toBeNull();
  });

  it("shows the upgrade prompt on free with no flag on the plan", () => {
    state.entitlements.customDomains = false;
    renderPage();
    expect(upgrade()).toBeTruthy();
    expect(editor()).toBeNull();
  });

  it("shows the editor when the server allows", () => {
    state.entitlements.customDomains = true;
    renderPage();
    expect(upgrade()).toBeNull();
    expect(editor()).toBeTruthy();
  });

  // EE without Firebase: appConfig.billingEnabled is false, so useBilling()
  // reports disabled. The page must still gate, because the server will.
  it("gates on EE without Firebase, where browser billing is unavailable", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    state.entitlements.customDomains = false;
    renderPage();
    expect(upgrade()).toBeTruthy();
    expect(editor()).toBeNull();
  });

  it("does not gate when EE is unavailable (self-hosted)", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    state.entitlements = { loading: false, customDomains: true, identityStitching: true };
    renderPage();
    expect(upgrade()).toBeNull();
    expect(editor()).toBeTruthy();
  });

  it("shows the loader while billing is still loading", () => {
    state.billing = { enabled: true, loading: true, settings: undefined };
    renderPage();
    expect(screen.queryByTestId("loading")).toBeTruthy();
    expect(editor()).toBeNull();
  });
});

it("survives billing loading-to-loaded with the actual entitlement hook", () => {
  state.billing.loading = true;
  const view = renderPage();
  state.billing.loading = false;
  state.entitlements.customDomains = false;
  view.rerender(React.createElement(WorkspaceDomains as any));
  expect(upgrade()).toBeTruthy();
});
it("keeps existing workspace domains editable when new domains are denied", () => {
  state.domains = [{ id: "domain1", name: "events.example.com" }];
  state.entitlements.customDomains = false;
  renderPage();
  expect(editor()).toBeTruthy();
  expect(upgrade()).toBeNull();
});
