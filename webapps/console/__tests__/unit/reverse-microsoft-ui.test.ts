// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MicrosoftResults } from "../../components/ReverseETL/MicrosoftResults";
import { MicrosoftAccountSelector } from "../../components/ReverseETL/MicrosoftAccountSelector";
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
  rpc.mockResolvedValue({ options: [{ value: "456", label: "Account (456)", customerId: "123" }] });
  const change = vi.fn();
  mount(
    React.createElement(MicrosoftAccountSelector, {
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
  await waitFor(() => expect(change).toHaveBeenCalledWith("456", "123"));
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
