// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// JITSU-228. settings/domains.tsx gated free workspaces with its own inline
// `planId === "free" && !featuresEnabled.includes("misc")` test until this
// ticket pointed it at the shared resolver. This covers that it still reaches
// the same verdicts — in particular that the `misc` grant survived the
// refactor, since honouring it is the whole reason the server gate had to
// learn about featuresEnabled.

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

  // The behaviour that predates JITSU-228 and had to survive the refactor. The
  // grant is resolved server-side and survives a billing failure,
  // so it reaches the page as a plain allow. Its
  // resolution is covered in plan-features; this asserts the page honours it.
  it("honours the per-workspace `misc` grant over an explicit plan denial", () => {
    state.entitlements.customDomains = true;
    state.featuresEnabled = ["misc"];
    renderPage();
    expect(upgrade()).toBeNull();
    expect(editor()).toBeTruthy();
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
