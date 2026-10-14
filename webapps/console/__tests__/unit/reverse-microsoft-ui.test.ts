// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MicrosoftResults } from "../../components/ReverseETL/MicrosoftResults";
import { OAuthAccountSelector } from "../../components/ConfigObjectEditor/OAuthAccountSelector";
import { DestinationTargetSelector } from "../../components/ReverseETL/DestinationTargetSelector";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("juava", async original => ({ ...(await original<typeof import("juava")>()), rpc }));
vi.mock("../../lib/context", () => ({ useWorkspace: () => ({ id: "ws" }) }));
const getComputedStyle = window.getComputedStyle.bind(window);
let client: QueryClient;
beforeEach(() => {
  rpc.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log() {}, warn() {}, error() {} },
  });
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => getComputedStyle(element));
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} }))
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(node: React.ReactNode) {
  return render(React.createElement(QueryClientProvider, { client }, node));
}
const common = { accountId: "456", observedAt: "2026-10-13T00:00:00Z" };
const pending = {
  ...common,
  kind: "pending",
  goal: "Purchase",
  start: "2026-09-12",
  end: "2026-10-11",
  continuation: "signed-report",
};
it("starts reporting on demand and checks the same report without starting a sync", async () => {
  rpc.mockResolvedValueOnce(pending).mockResolvedValueOnce({
    ...pending,
    kind: "conversions",
    totals: [{ currency: "USD", conversions: 1.5, revenue: 12 }],
  });
  mount(React.createElement(MicrosoftResults, { syncId: "sync" }));
  expect(rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh Microsoft results" }));
  await screen.findByText("Preparing report");
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Check report status" }) as HTMLButtonElement).disabled).toBe(false)
  );
  fireEvent.click(screen.getByRole("button", { name: "Check report status" }));
  await screen.findByText("1.5");
  expect(rpc).toHaveBeenLastCalledWith("/api/ws/reverse-etl/microsoft-results", {
    method: "POST",
    body: { syncId: "sync", continuation: "signed-report" },
  });
  expect(screen.getByText(/Last 30 completed days/)).toBeTruthy();
  expect(screen.getByText(/These totals include other senders/)).toBeTruthy();
  expect(screen.queryByText("Preparing report")).toBeNull();
});
it("retains a pending report after a transient read error", async () => {
  rpc.mockResolvedValueOnce(pending).mockRejectedValueOnce(new Error("Microsoft request unavailable"));
  mount(React.createElement(MicrosoftResults, { syncId: "sync" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh Microsoft results" }));
  await screen.findByText("Preparing report");
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Check report status" }) as HTMLButtonElement).disabled).toBe(false)
  );
  fireEvent.click(screen.getByRole("button", { name: "Check report status" }));
  await screen.findByText("Microsoft request unavailable");
  expect(screen.getByText("Preparing report")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check report status" })).toBeTruthy();
});
it("shows missing audience size independently from zero", async () => {
  rpc.mockResolvedValue({
    ...common,
    kind: "audience",
    targetId: "789",
    name: "Customers",
    searchSize: "0",
    audienceNetworkSize: null,
  });
  mount(React.createElement(MicrosoftResults, { syncId: "sync" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh Microsoft results" }));
  await screen.findByText("Not reported yet");
  expect(screen.getByText("0")).toBeTruthy();
  expect(screen.getByText(/not a per-upload match rate/)).toBeTruthy();
});
it("fills account and customer together from a lazy account lookup", async () => {
  rpc.mockResolvedValue({ options: [{ value: "456", label: "Account (456)", customerId: "123", accountId: "456" }] });
  const change = vi.fn();
  mount(
    React.createElement(OAuthAccountSelector, {
      provider: "microsoft-ads",
      destinationId: "dest",
      isNew: false,
      disabled: false,
      onChange: change,
    })
  );
  expect(rpc).not.toHaveBeenCalled();
  const account = screen.getByRole("combobox", { name: "Microsoft advertising account" });
  expect(screen.getByLabelText("Microsoft advertising account")).toBe(account);
  expect(document.getElementById(account.getAttribute("aria-describedby")!)?.textContent).toContain(
    "Selecting an account fills both IDs below"
  );
  fireEvent.focus(account);
  fireEvent.mouseDown(account);
  const text = await screen.findAllByText("Account (456)");
  fireEvent.click(text[text.length - 1]);
  await waitFor(() =>
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ accountId: "456", customerId: "123" }))
  );
});
it("keeps exact goal-name entry available when lookup fails", async () => {
  rpc.mockRejectedValue(new Error("Lookup unavailable"));
  const change = vi.fn();
  mount(
    React.createElement(DestinationTargetSelector, {
      destinationId: "dest",
      kind: "microsoft-goal",
      value: "",
      onChange: change,
      disabled: false,
    })
  );
  fireEvent.focus(screen.getByRole("combobox"));
  await screen.findByText(/You can enter the goal name manually/);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Purchase" } });
  expect(change.mock.calls[0][0]).toBe("Purchase");
});

it("browses accounts before saving using the draft grant and fills both IDs", async () => {
  rpc.mockResolvedValue({ options: [{ value: "456", label: "Draft account", customerId: "123", accountId: "456" }] });
  const change = vi.fn();
  mount(
    React.createElement(OAuthAccountSelector, {
      provider: "microsoft-ads",
      destinationId: "draft",
      isNew: true,
      draftGrant: "signed",
      authorized: true,
      developerToken: "self-hosted-token",
      disabled: false,
      onChange: change,
    })
  );
  const account = screen.getByRole("combobox");
  fireEvent.focus(account);
  fireEvent.mouseDown(account);
  const labels = await screen.findAllByText("Draft account");
  fireEvent.click(labels[labels.length - 1]);
  expect(rpc).toHaveBeenCalledWith(
    "/api/ws/destination-accounts",
    expect.objectContaining({
      method: "POST",
      body: {
        action: "draft-accounts",
        provider: "microsoft-ads",
        grant: "signed",
        developerToken: "self-hosted-token",
      },
    })
  );
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ accountId: "456", customerId: "123" }));
});

it("does not browse an unauthorized draft", () => {
  mount(
    React.createElement(OAuthAccountSelector, {
      provider: "microsoft-ads",
      destinationId: "draft",
      isNew: true,
      draftGrant: "signed",
      authorized: false,
      disabled: false,
      onChange: vi.fn(),
    })
  );
  expect((screen.getByRole("combobox") as HTMLInputElement).disabled).toBe(true);
  expect(rpc).not.toHaveBeenCalled();
});

it("selects a Google manager access route and refreshes cached accounts after reauthorization", async () => {
  const managed = {
    value: "2222222222:1111111111",
    label: "Ads via manager",
    customerId: "2222222222",
    loginCustomerId: "1111111111",
  };
  rpc.mockResolvedValue({ options: [managed], partial: true, truncated: true });
  const change = vi.fn();
  const props = {
    provider: "google-ads" as const,
    destinationId: "draft",
    isNew: true,
    draftGrant: "grant",
    authorized: true,
    disabled: false,
    onChange: change,
  };
  const view = mount(React.createElement(OAuthAccountSelector, props));
  const account = screen.getByRole("combobox", { name: "Google Ads account" });
  fireEvent.focus(account);
  fireEvent.mouseDown(account);
  const labels = await screen.findAllByText("Ads via manager");
  fireEvent.click(labels[labels.length - 1]);
  expect(change).toHaveBeenCalledWith(expect.objectContaining(managed));
  expect(rpc).toHaveBeenCalledWith(
    "/api/ws/destination-accounts",
    expect.objectContaining({
      body: { action: "draft-accounts", provider: "google-ads", grant: "grant", developerToken: undefined },
    })
  );
  expect(screen.getByText(/Some accounts could not be loaded/)).toBeTruthy();
  expect(screen.getByText(/Account discovery reached its limit/)).toBeTruthy();
  view.rerender(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(OAuthAccountSelector, { ...props, authorizationRevision: 1 })
    )
  );
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
});
