// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// JITSU-228. Proves the Identity Stitching toggle is actually disabled with a
// contact-sales note when the plan denies, and — the part the resolver tests
// cannot reach — that a connection which ALREADY has it stays editable.

const state = vi.hoisted(() => ({
  billing: { enabled: true, loading: false, settings: {} as any },
  entitlements: { loading: false, customDomains: true as boolean | null, identityStitching: true as boolean | null },
  linkFunctions: [] as any[],
  hasExistingLink: false,
}));

const ID = "builtin.transformation.user-recognition";

vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slug: "ws", slugOrId: "ws", featuresEnabled: [] }),
  useWorkspaceRole: () => ({ editEntities: true, deleteEntities: true }),
}));
vi.mock("../../components/Billing/BillingProvider", () => ({ useBilling: () => state.billing }));
vi.mock("../../lib/entitlements", () => ({ useEntitlements: () => state.entitlements }));
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
  state.entitlements = {
    loading: false,
    customDomains: true as boolean | null,
    identityStitching: true as boolean | null,
  };
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
    state.entitlements.identityStitching = true;
    renderEditor();
    expect(screen.queryByText("Identity Stitching")).toBeTruthy();
  });

  it("shows the contact-sales note when the plan denies", () => {
    state.entitlements.identityStitching = false;
    renderEditor();
    expect(contactSales()).toBeTruthy();
  });

  it("shows no note on enterprise", () => {
    state.entitlements.identityStitching = true;
    renderEditor();
    expect(contactSales()).toBeNull();
  });

  // The grandfathering half: a connection that already has it is not locked,
  // matching assertIdentityStitchingAllowed on the server.
  it("does not lock a connection that already has it, even below enterprise", () => {
    state.entitlements.identityStitching = false;
    state.hasExistingLink = true;
    state.linkFunctions = [{ functionId: ID }];
    renderEditor();
    expect(contactSales()).toBeNull();
  });

  // EE without Firebase: appConfig.billingEnabled is false, so useBilling()
  // reports disabled and the old gate went inert while the server still
  // refused the save. Same split as custom domains — this one was live from the
  // day it shipped, since stitching never had a dark period.
  it("gates on EE without Firebase, where browser billing is unavailable", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    state.entitlements.identityStitching = false;
    renderEditor();
    expect(contactSales()).toBeTruthy();
  });

  it("does not gate when EE is unavailable (self-hosted)", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    state.entitlements = {
      loading: false,
      customDomains: true as boolean | null,
      identityStitching: true as boolean | null,
    };
    renderEditor();
    expect(contactSales()).toBeNull();
  });
});

it("withholds new stitching during a lookup failure without an upgrade prompt", () => {
  state.entitlements.identityStitching = null;
  renderEditor();
  expect(contactSales()).toBeNull();
  expect(screen.queryByText(/Could not verify access/)).toBeTruthy();
  const toggle = screen.getByRole("status").parentElement?.querySelector<HTMLButtonElement>('[role="switch"]');
  expect(toggle?.disabled).toBe(true);
});
it("keeps existing stitching editable during a lookup failure", () => {
  state.entitlements.identityStitching = null;
  state.hasExistingLink = true;
  state.linkFunctions = [{ functionId: ID }];
  renderEditor();
  expect(screen.queryByText(/Could not verify access/)).toBeNull();
});
