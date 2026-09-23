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
  featuresEnabled: [] as string[],
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
vi.mock("../../components/Billing/UpgradeDialog", () => ({
  UpgradeDialog: ({ featureDescription }: any) =>
    React.createElement("div", { "data-testid": "upgrade-dialog" }, featureDescription),
}));
vi.mock("../../components/GlobalLoader/GlobalLoader", () => ({
  LoadingAnimation: () => React.createElement("div", { "data-testid": "loading" }),
}));
vi.mock("../../lib/useApi", () => ({ useConfigApi: () => ({ create: vi.fn(), del: vi.fn() }) }));
vi.mock("../../lib/store", () => ({
  useConfigObjectList: () => [],
  useConfigObjectMutation: () => ({ mutateAsync: vi.fn() }),
}));

const WorkspaceDomains = (await import("../../pages/[workspaceId]/settings/domains")).default;

const renderPage = () => render(React.createElement(WorkspaceDomains as any));
const upgrade = () => screen.queryByTestId("upgrade-dialog");
const editor = () => screen.queryByTestId("domains-editor");

beforeEach(() => {
  state.billing = { enabled: true, loading: false, settings: {} };
  state.featuresEnabled = [];
});
afterEach(cleanup);

describe("workspace domains page gate", () => {
  it("shows the upgrade dialog when the plan denies", () => {
    state.billing.settings = { planId: "free", customDomainsEnabled: false };
    renderPage();
    expect(upgrade()?.textContent).toBe("Workspace Domains");
    expect(editor()).toBeNull();
  });

  // The behaviour that predates JITSU-228 and had to survive the refactor.
  it("honours the per-workspace `misc` grant over an explicit plan denial", () => {
    state.billing.settings = { planId: "free", customDomainsEnabled: false };
    state.featuresEnabled = ["misc"];
    renderPage();
    expect(upgrade()).toBeNull();
    expect(editor()).toBeTruthy();
  });

  it("shows the upgrade prompt on free with no flag on the plan", () => {
    state.billing.settings = { planId: "free" };
    renderPage();
    expect(upgrade()).toBeTruthy();
    expect(editor()).toBeNull();
  });

  it("shows the editor on a plan that allows", () => {
    state.billing.settings = { planId: "business" };
    renderPage();
    expect(upgrade()).toBeNull();
    expect(editor()).toBeTruthy();
  });

  it("does not gate when billing is disabled (self-hosted)", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
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
