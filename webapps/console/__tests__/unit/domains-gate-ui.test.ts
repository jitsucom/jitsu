// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// JITSU-228. The gate logic is covered by plan-features/plan-gate; this covers
// the thing neither can: that the component actually keeps the add-domain
// control on screen but locked, with the reason in a tooltip and inline, when
// the plan does not include custom domains, that a final removal says so, and
// that the per-workspace `misc` grant still lets a free workspace add one.

const state = vi.hoisted(() => ({
  billing: { enabled: true, loading: false, settings: {} as any },
  entitlements: { loading: false, customDomains: true as boolean | null, identityStitching: true as boolean | null },
  featuresEnabled: [] as string[],
  retry: vi.fn(),
  confirmOp: vi.fn(async (_message: string) => true),
}));

vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slug: "ws", featuresEnabled: state.featuresEnabled }),
}));
vi.mock("../../components/Billing/BillingProvider", () => ({ useBilling: () => state.billing }));
vi.mock("../../lib/entitlements", () => ({ useEntitlements: () => ({ ...state.entitlements, retry: state.retry }) }));
vi.mock("../../lib/useApi", () => ({ get: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../lib/modal", () => ({ useAntdModal: () => ({}), getAntdModal: () => ({}) }));
vi.mock("../../lib/ui", () => ({ confirmOp: state.confirmOp, feedbackError: vi.fn() }));
vi.mock("next/router", () => ({ useRouter: () => ({ push: vi.fn(), query: {} }) }));
vi.mock("../../components/Workspace/WLink", () => ({
  WLink: ({ children, href }: any) => React.createElement("a", { href }, children),
}));
// The real button also enforces roles; here it only needs to expose what the
// editor passes it, so the tests can find the Add and remove buttons.
vi.mock("../../components/JitsuButton/JitsuButton", () => ({
  JitsuButton: ({ children, disabled, onClick, requiredPermission }: any) =>
    React.createElement("button", { disabled, onClick, "data-permission": requiredPermission }, children),
}));

// jsdom has no ResizeObserver, which antd's Tooltip (rc-trigger) subscribes to.
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { DomainsEditor, domainsLockedTooltip, removeDomainConfirmation } = await import(
  "../../components/DomainsEditor/DomainsEditor"
);

const renderEditor = (value: string[] = []) =>
  render(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      React.createElement(DomainsEditor as any, {
        context: "site",
        value,
        workspaceDomains: [],
        onChange: () => {},
      })
    )
  );

beforeEach(() => {
  state.billing = { enabled: true, loading: false, settings: {} };
  state.entitlements = {
    loading: false,
    customDomains: true as boolean | null,
    identityStitching: true as boolean | null,
  };
  state.featuresEnabled = [];
  state.confirmOp.mockClear();
  state.confirmOp.mockResolvedValue(true);
});
afterEach(cleanup);

const addControl = () => screen.queryByPlaceholderText("subdomain.mywebsite.com") as HTMLInputElement | null;
const addButton = () => screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
const hint = () => screen.queryByText(/Available on/i);
const removeButton = (container: HTMLElement) =>
  container.querySelector('[data-permission="deleteEntities"]') as HTMLButtonElement;

describe("DomainsEditor plan gate", () => {
  it("keeps the add control on screen but locked, with an inline hint, when the server denies", () => {
    state.entitlements.customDomains = false;
    renderEditor();
    expect(addControl()).toBeTruthy();
    expect(addControl()!.disabled).toBe(true);
    expect(addButton().disabled).toBe(true);
    expect(hint()).toBeTruthy();
  });

  // An empty field already disables Add, so the check above cannot tell a locked
  // button from an idle one. Put a value in the field and Add must still be locked.
  it("keeps Add locked even when the field has a value", () => {
    state.entitlements.customDomains = false;
    renderEditor();
    fireEvent.change(addControl()!, { target: { value: "data.example.com" } });
    expect(addControl()!.value).toBe("data.example.com");
    expect(addButton().disabled).toBe(true);
  });

  it("links to upgrade when billing is available, and names an administrator when it is not", () => {
    state.entitlements.customDomains = false;
    renderEditor();
    expect(screen.getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe("/settings/billing");
    cleanup();
    state.billing = { enabled: false, loading: false, settings: undefined };
    renderEditor();
    expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
    expect(screen.getByText(/Contact your workspace administrator to change the plan/i)).toBeTruthy();
  });

  it("explains the lock in a tooltip on the disabled Add button", async () => {
    state.entitlements.customDomains = false;
    renderEditor();
    fireEvent.mouseEnter(addButton().parentElement as HTMLElement);
    await waitFor(() => expect(screen.getAllByText(/Your existing domains keep working/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Upgrade to add more/i).length).toBeGreaterThan(0);
  });

  it("enables the add control and shows no hint when the server allows", () => {
    state.entitlements.customDomains = true;
    renderEditor();
    expect(addControl()!.disabled).toBe(false);
    expect(hint()).toBeNull();
    fireEvent.change(addControl()!, { target: { value: "data.example.com" } });
    expect(addButton().disabled).toBe(false);
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
    expect(addControl()!.disabled).toBe(true);
    expect(hint()).toBeTruthy();
  });

  it("allows an eligible workspace on EE without Firebase", () => {
    state.billing = { enabled: false, loading: false, settings: undefined };
    state.entitlements.customDomains = true;
    renderEditor();
    expect(addControl()!.disabled).toBe(false);
    expect(hint()).toBeNull();
  });

  // The misc grant and explicit flags are resolved server-side now, so from the
  // component's side they arrive as a plain allow. Their resolution is covered
  // in plan-features; what matters here is that an allow renders as an allow.
  it("enables the add control when an explicit grant makes the server allow", () => {
    state.featuresEnabled = ["misc"];
    state.entitlements.customDomains = true;
    renderEditor();
    expect(addControl()!.disabled).toBe(false);
    expect(hint()).toBeNull();
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
    expect(addControl()!.disabled).toBe(false);
    expect(hint()).toBeNull();
  });

  // Never flash a locked control or an upgrade prompt at someone who may be entitled.
  it("withholds new domain controls while the lookup is in flight", () => {
    state.entitlements = { loading: true, customDomains: null, identityStitching: null };
    renderEditor();
    expect(hint()).toBeNull();
    expect(addControl()).toBeNull();
    expect(screen.queryByText("Checking access…")).toBeTruthy();
  });
});

describe("DomainsEditor removing a configured domain", () => {
  it("warns that it cannot be added back when the plan has no custom domains", async () => {
    state.entitlements.customDomains = false;
    const { container } = renderEditor(["site.example.com"]);
    fireEvent.click(removeButton(container));
    await waitFor(() => expect(state.confirmOp).toHaveBeenCalledTimes(1));
    const message = state.confirmOp.mock.calls[0][0] as string;
    expect(message).toContain("site.example.com");
    expect(message).toMatch(/won't be able to add it back unless you upgrade to Business or Enterprise/);
  });

  it("keeps the ordinary confirmation when the plan can add domains", async () => {
    state.entitlements.customDomains = true;
    const { container } = renderEditor(["site.example.com"]);
    fireEvent.click(removeButton(container));
    await waitFor(() => expect(state.confirmOp).toHaveBeenCalledTimes(1));
    expect(state.confirmOp.mock.calls[0][0]).toBe("Are you sure you want to remove domain site.example.com?");
  });
});

describe("copy", () => {
  it("tooltip ends with the upgrade path that exists", () => {
    expect(domainsLockedTooltip(true)).toMatch(/Upgrade to add more\.$/);
    expect(domainsLockedTooltip(false)).toMatch(/Contact your workspace administrator to change the plan\.$/);
    expect(domainsLockedTooltip(true)).toContain("Business and Enterprise");
  });

  it("makes no claim about traffic when a domain is removed", () => {
    expect(removeDomainConfirmation("a.example.com", true)).not.toMatch(/traffic|served|stop/i);
  });
});

it("withholds adding on failure and offers retry without a locked control or upgrade prompt", () => {
  state.entitlements.customDomains = null;
  renderEditor();
  expect(addControl()).toBeNull();
  expect(hint()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.retry).toHaveBeenCalledTimes(1);
});
