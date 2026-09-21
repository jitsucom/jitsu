// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// JITSU-228. Proves the Identity Stitching toggle is actually disabled with a
// contact-sales note when the plan denies, and — the part the resolver tests
// cannot reach — that a connection which ALREADY has it stays editable.

const state = vi.hoisted(() => ({
  billing: { enabled: true, loading: false, settings: {} as any },
  linkFunctions: [] as any[],
  hasExistingLink: false,
}));

const ID = "builtin.transformation.user-recognition";

vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slug: "ws", slugOrId: "ws", featuresEnabled: [] }),
  useWorkspaceRole: () => ({ editEntities: true, deleteEntities: true }),
}));
vi.mock("../../components/Billing/BillingProvider", () => ({ useBilling: () => state.billing }));
vi.mock("../../lib/store", () => ({ useStoreReload: () => async () => {} }));
vi.mock("next/router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), query: state.hasExistingLink ? { id: "lnk" } : {} }),
}));

const ConnectionEditor = (await import("../../components/ConnectionEditorPage/ConnectionEditorPage")).default;

const streams = [{ id: "s1", name: "Site", type: "stream" }] as any;
const destinations = [{ id: "d1", name: "CH", destinationType: "clickhouse", type: "destination" }] as any;
const functions = [] as any;
const links = () =>
  state.hasExistingLink
    ? ([
        {
          id: "lnk",
          fromId: "s1",
          toId: "d1",
          type: "push",
          workspaceId: "ws",
          data: { mode: "batch", deduplicate: true, primaryKey: "message_id", functions: state.linkFunctions },
        },
      ] as any)
    : ([] as any);

const renderEditor = () =>
  render(React.createElement(ConnectionEditor as any, { streams, destinations, links: links(), functions }));

beforeEach(() => {
  state.billing = { enabled: true, loading: false, settings: {} };
  state.linkFunctions = [];
  state.hasExistingLink = false;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});
afterEach(cleanup);

const contactSales = () => screen.queryByText(/Contact sales/i);

describe("Identity Stitching plan gate", () => {
  it("renders the toggle at all (sanity: the section exists for this destination)", () => {
    state.billing.settings = { planId: "enterprise" };
    renderEditor();
    expect(screen.queryByText("Identity Stitching")).toBeTruthy();
  });

  it("shows the contact-sales note when the plan denies", () => {
    state.billing.settings = { planId: "business" };
    renderEditor();
    expect(contactSales()).toBeTruthy();
  });

  it("shows no note on enterprise", () => {
    state.billing.settings = { planId: "enterprise" };
    renderEditor();
    expect(contactSales()).toBeNull();
  });

  // The grandfathering half: a connection that already has it is not locked,
  // matching assertIdentityStitchingAllowed on the server.
  it("does not lock a connection that already has it, even below enterprise", () => {
    state.billing.settings = { planId: "business" };
    state.hasExistingLink = true;
    state.linkFunctions = [{ functionId: ID }];
    renderEditor();
    expect(contactSales()).toBeNull();
  });

  it("does not gate when billing is disabled (self-hosted)", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    renderEditor();
    expect(contactSales()).toBeNull();
  });
});
