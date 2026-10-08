// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MetaResults } from "../../components/ReverseETL/MetaResults";
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
const observedAt = "2026-10-08T00:00:00Z";
function mount(syncId = "sync", configurationKey?: string) {
  const wrapper = ({ children }: React.PropsWithChildren) =>
    React.createElement(QueryClientProvider, { client }, children);
  return render(React.createElement(MetaResults, { syncId, configurationKey }), { wrapper });
}
it("separates dataset-wide quality from run acceptance and keeps real zero distinct from missing metrics", async () => {
  rpc.mockResolvedValue({
    kind: "conversions",
    observedAt,
    targetId: "789",
    events: [
      { eventName: "Purchase", emq: { status: "available", value: 8.6 }, acr: { status: "available", value: 37.9 } },
      {
        eventName: "Lead",
        emq: { status: "available", value: 0 },
        acr: { status: "unavailable", reason: "not-reported" },
      },
    ],
  });
  mount();
  await screen.findByText("8.6 / 10");
  expect(screen.getByText("37.9%")).toBeTruthy();
  expect(screen.getByText("0 / 10")).toBeTruthy();
  expect(screen.getByText("Not available")).toBeTruthy();
  expect(screen.getByText(/across all senders/)).toBeTruthy();
  expect(screen.getByText(/not the acceptance counts/)).toBeTruthy();
  expect(screen.getByText(/fetch time, not the last time Meta processed/)).toBeTruthy();
  expect(rpc).toHaveBeenCalledWith(
    "/api/ws/reverse-etl/meta-results",
    expect.objectContaining({ query: { syncId: "sync" } })
  );
});
it("explains empty quality data and permission denial without showing a zero", async () => {
  rpc.mockResolvedValueOnce({ kind: "conversions", observedAt, targetId: "789", events: [] }).mockResolvedValueOnce({
    kind: "unavailable",
    observedAt,
    reason: "permissions",
    message: "Grant reporting access in Events Manager",
  });
  mount();
  await screen.findByText("No web-event quality metrics reported yet");
  expect(screen.getByText(/does not mean zero events/)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Refresh Meta results" }));
  await screen.findByText("Grant reporting access in Events Manager");
  expect(screen.queryByText("No web-event quality metrics reported yet")).toBeNull();
});
it("shows an approximate audience range and the completed snapshot denominator", async () => {
  rpc.mockResolvedValue({
    kind: "audience",
    observedAt,
    targetId: "456",
    size: { status: "available", lower: 2900, upper: 3100 },
    matchRate: { status: "available", lower: 58, upper: 62 },
    denominatorRows: 5000,
    snapshotAt: observedAt,
    operationCode: 200,
    deliveryCode: 200,
  });
  mount();
  await screen.findByText("2,900 – 3,100");
  expect(screen.getByText("58% – 62%")).toBeTruthy();
  expect(screen.getByText(/5,000 \(recorded/)).toBeTruthy();
  expect(screen.getByText("Ready for ads")).toBeTruthy();
  expect(screen.getByText(/estimate, not a measured upload match rate/)).toBeTruthy();
});
it("explains a privacy-limited match estimate", async () => {
  rpc.mockResolvedValue({
    kind: "audience",
    observedAt,
    targetId: "456",
    size: { status: "available", lower: 0, upper: 1000 },
    matchRate: { status: "unavailable", reason: "privacy-limited" },
  });
  mount();
  await screen.findByText(/limits small-audience estimates for privacy/);
  expect(screen.queryByText("0%")).toBeNull();
});
it("manual refresh reads metrics only and hides old numbers when refresh fails", async () => {
  rpc
    .mockResolvedValueOnce({
      kind: "audience",
      observedAt,
      targetId: "456",
      size: { status: "available", lower: 2900, upper: 3100 },
      matchRate: { status: "unavailable", reason: "not-eligible" },
    })
    .mockRejectedValueOnce(new Error("Network failure"));
  mount();
  await screen.findByText("2,900 – 3,100");
  fireEvent.click(await screen.findByRole("button", { name: "Refresh Meta results" }));
  await screen.findByText("Meta results could not be loaded");
  expect(screen.queryByText("2,900 – 3,100")).toBeNull();
  expect(rpc.mock.calls.every(([url, options]) => url.endsWith("/meta-results") && options.method === undefined)).toBe(
    true
  );
});
it("does not reuse another sync's results", async () => {
  rpc
    .mockResolvedValueOnce({
      kind: "unavailable",
      observedAt,
      reason: "no-target",
      message: "First sync target is pending",
    })
    .mockResolvedValueOnce({
      kind: "unavailable",
      observedAt,
      reason: "no-target",
      message: "Second sync target is pending",
    });
  const view = mount();
  await screen.findByText("First sync target is pending");
  view.rerender(React.createElement(MetaResults, { syncId: "second" }));
  await screen.findByText("Second sync target is pending");
  expect(screen.queryByText("First sync target is pending")).toBeNull();
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
});

it("does not reuse cached metrics when the same sync is retargeted", async () => {
  rpc
    .mockResolvedValueOnce({ kind: "conversions", observedAt, targetId: "789", events: [] })
    .mockResolvedValueOnce({ kind: "conversions", observedAt, targetId: "790", events: [] });
  const view = mount("sync", "pixel-789");
  await screen.findByText(/Dataset ID: 789/);
  view.rerender(React.createElement(MetaResults, { syncId: "sync", configurationKey: "pixel-790" }));
  await screen.findByText(/Dataset ID: 790/);
  expect(screen.queryByText(/Dataset ID: 789/)).toBeNull();
  expect(rpc).toHaveBeenCalledTimes(2);
});
