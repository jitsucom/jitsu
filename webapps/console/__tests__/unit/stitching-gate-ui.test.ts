// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDENTITY_STITCHING_OFF_WARNING } from "../../lib/shared/plan-features";

// JITSU-228. Proves the Identity Stitching toggle is actually disabled with a
// contact-sales note when the plan denies, and — the part the resolver tests
// cannot reach — that a connection which ALREADY has it stays editable.

const state = vi.hoisted(() => ({
  billing: { enabled: true, loading: false, settings: {} as any },
  entitlements: { loading: false, customDomains: true as boolean | null, identityStitching: true as boolean | null },
  linkFunctions: [] as any[],
  hasExistingLink: false,
  confirmOp: vi.fn(async (_message: string) => true),
}));

const ID = "builtin.transformation.user-recognition";

vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slug: "ws", slugOrId: "ws", featuresEnabled: [] }),
  useWorkspaceRole: () => ({ editEntities: true, deleteEntities: true }),
}));
vi.mock("../../components/Billing/BillingProvider", () => ({ useBilling: () => state.billing }));
vi.mock("../../lib/entitlements", () => ({ useEntitlements: () => state.entitlements }));
vi.mock("../../lib/store", () => ({ useStoreReload: () => async () => {} }));
vi.mock("../../lib/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/ui")>()),
  confirmOp: state.confirmOp,
}));
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
  state.confirmOp.mockClear();
  state.confirmOp.mockResolvedValue(true);
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

// Turning stitching off on a plan that cannot turn it back on is one-way, so it
// asks first; and because the server compares against the stored connection,
// the switch stays usable before Save so a mistake can be undone.
describe("turning Identity Stitching off on a plan that cannot turn it back on", () => {
  const stitchingSwitch = () =>
    screen.getByTestId("identity-stitching").querySelector('[role="switch"]') as HTMLButtonElement;
  const isOn = () => stitchingSwitch().getAttribute("aria-checked") === "true";

  const withStitchingOn = (identityStitching: boolean | null) => {
    state.entitlements.identityStitching = identityStitching;
    state.hasExistingLink = true;
    state.linkFunctions = [{ functionId: ID }];
    renderEditor();
  };

  it("asks first, with the approved text, when the plan is below Enterprise", async () => {
    withStitchingOn(false);
    expect(isOn()).toBe(true);
    fireEvent.click(stitchingSwitch());
    await waitFor(() => expect(state.confirmOp).toHaveBeenCalledTimes(1));
    expect(state.confirmOp).toHaveBeenCalledWith(IDENTITY_STITCHING_OFF_WARNING);
    expect(IDENTITY_STITCHING_OFF_WARNING).toMatch(/won't be able to turn it back on unless you upgrade/);
    await waitFor(() => expect(isOn()).toBe(false));
  });

  it("leaves it on when the user cancels", async () => {
    state.confirmOp.mockResolvedValue(false);
    withStitchingOn(false);
    fireEvent.click(stitchingSwitch());
    await waitFor(() => expect(state.confirmOp).toHaveBeenCalledTimes(1));
    expect(isOn()).toBe(true);
  });

  // The server compares with the stored connection, so on and back off-on before
  // Save is a no-op there. The switch must not lock the moment it is turned off.
  it("lets the user turn it back on before saving, without asking again", async () => {
    withStitchingOn(false);
    fireEvent.click(stitchingSwitch());
    await waitFor(() => expect(isOn()).toBe(false));
    expect(stitchingSwitch().disabled).toBe(false);
    fireEvent.click(stitchingSwitch());
    await waitFor(() => expect(isOn()).toBe(true));
    expect(state.confirmOp).toHaveBeenCalledTimes(1);
  });

  it("does not ask on Enterprise", async () => {
    withStitchingOn(true);
    fireEvent.click(stitchingSwitch());
    await waitFor(() => expect(isOn()).toBe(false));
    expect(state.confirmOp).not.toHaveBeenCalled();
  });

  // Nothing is known about whether it could be turned back on, so no warning
  // that claims it could not.
  it("does not ask while the plan lookup is unknown", async () => {
    withStitchingOn(null);
    fireEvent.click(stitchingSwitch());
    await waitFor(() => expect(isOn()).toBe(false));
    expect(state.confirmOp).not.toHaveBeenCalled();
  });

  it("still locks a connection that never had it", () => {
    state.entitlements.identityStitching = false;
    state.hasExistingLink = true;
    state.linkFunctions = [];
    renderEditor();
    expect(stitchingSwitch().disabled).toBe(true);
  });
});
