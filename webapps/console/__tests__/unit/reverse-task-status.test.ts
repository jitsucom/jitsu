// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ReverseTaskStatus } from "../../components/ReverseETL/TaskStatus";
import { ReverseDeliveryStatistics } from "../../components/ReverseETL/DeliveryStatistics";
import { ReverseTask } from "../../lib/reverse-etl";

vi.mock("../../components/JitsuButton/JitsuButton", () => ({
  WJitsuButton: ({ href, children }: any) => React.createElement("a", { href }, children),
}));
const getComputedStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => getComputedStyle(element));
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addListener() {}, removeListener() {} }));
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const task = (stats?: unknown) =>
  ReverseTask.parse({
    task_id: "task",
    sync_id: "sync",
    status: "WAITING",
    started_at: new Date(),
    updated_at: new Date(),
    description: null,
    error: null,
    stats: stats ?? null,
  });
const counts = {
  total: 0,
  prepared: 0,
  unconfirmed: 0,
  pending: 0,
  accepted: 0,
  rejected: 0,
  partial: 0,
  cancelled: 0,
};
describe("Reverse ETL status dropdown", () => {
  it.each(["PENDING", "RUNNING", "COMPLETE", "FAILED"])(
    "shows the latest-log error indicator for %s only when the status is not already failed",
    status => {
      render(React.createElement(ReverseTaskStatus, { task: { ...task(), status, latestLogLevel: "ERROR" } }));
      expect(!!screen.queryByRole("img", { name: "Latest log entry is an error" })).toBe(status !== "FAILED");
      if (status === "FAILED") expect(screen.getByText("FAILED").classList.contains("ant-tag-red")).toBe(true);
    }
  );
  it("does not flag a non-error latest log entry", () => {
    render(React.createElement(ReverseTaskStatus, { task: { ...task(), latestLogLevel: "INFO" } }));
    expect(screen.queryByRole("img", { name: "Latest log entry is an error" })).toBeNull();
  });
  it.each([
    ["WAITING", "PENDING"],
    ["PENDING", "PENDING"],
    ["SUCCESS", "COMPLETE"],
    ["COMPLETE", "COMPLETE"],
  ])("shows %s as green %s", (stored, label) => {
    render(React.createElement(ReverseTaskStatus, { task: { ...task(), status: stored } }));
    const button = screen.getByRole("button", { name: new RegExp(label) });
    expect(button.querySelector(".ant-tag-green")).toBeTruthy();
  });
  it("shows nonzero status columns with Accepted and bold Total last, and keeps cleanup separate", async () => {
    render(
      React.createElement(ReverseTaskStatus, {
        task: task({
          version: 1,
          runId: "run",
          observedAt: "2026-01-01T00:00:00.000Z",
          upsert: { ...counts, total: 4, accepted: 3, pending: 1 },
          remove: { ...counts, total: 2, rejected: 2 },
          records: { accepted: 300, pending: 100, rejected: 20 },
          recordCounts: {
            upsert: { ...counts, total: 400, accepted: 300, pending: 100 },
            remove: { ...counts, total: 20, rejected: 20 },
          },
          replacement: "pending",
        }),
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /PENDING/ }));
    const upload = (await screen.findByText("Full-snapshot uploads")).closest("tr")!;
    expect(screen.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual([
      "Operation",
      "Pending",
      "Rejected",
      "Accepted",
      "Total",
    ]);
    expect(
      within(upload)
        .getAllByRole("cell")
        .map(cell => cell.textContent)
    ).toEqual(["Full-snapshot uploads", "100", "0", "300", "400"]);
    const removal = screen.getByText("Removals").closest("tr")!;
    expect(
      within(removal)
        .getAllByRole("cell")
        .map(cell => cell.textContent)
    ).toEqual(["Removals", "0", "20", "0", "20"]);
    expect(screen.getByRole("columnheader", { name: "Total" }).querySelector("strong")).toBeTruthy();
    expect(upload.lastElementChild?.querySelector("strong")?.textContent).toBe("400");
    expect(removal.lastElementChild?.querySelector("strong")?.textContent).toBe("20");
    const cleanup = screen.getByRole("region", { name: "Full-mirror cleanup request" });
    expect(cleanup.textContent).toContain("separate request, not a removal batch");
    expect(within(cleanup).getByText("PENDING")).toBeTruthy();
    expect(screen.getByText(/Records:/).textContent).toContain("300 accepted");
    expect(screen.getByRole("link", { name: "Show Logs" }).getAttribute("href")).toBe(
      "/reverse-syncs/logs?syncId=sync&taskId=task"
    );
  });
  it.each([
    ["not_started", "NOT STARTED", "Cleanup starts after all snapshot uploads are accepted."],
    [
      "prepared",
      "UNCONFIRMED",
      "Cleanup may already have reached Google, but its outcome is unconfirmed. Do not replay cleanup or reset state. Check the run logs and contact your administrator for reconciliation.",
    ],
    ["pending", "PENDING", "Uploads are accepted. Waiting for Google to finish removing older audience membership."],
    ["accepted", "ACCEPTED", "Google has confirmed cleanup of older audience membership."],
  ])("shows %s cleanup independently of fully accepted record counts", (replacement, label, description) => {
    render(
      React.createElement(ReverseDeliveryStatistics, {
        task: task({
          version: 1,
          runId: "run",
          observedAt: "2026-01-01T00:00:00.000Z",
          upsert: { ...counts, total: 5, accepted: 5 },
          remove: counts,
          records: { accepted: 4250, pending: 0, rejected: 0 },
          recordCounts: { upsert: { ...counts, total: 4250, accepted: 4250 }, remove: counts },
          replacement,
        }),
      })
    );
    const cleanup = screen.getByRole("region", { name: "Full-mirror cleanup request" });
    expect(within(cleanup).getByText(label)).toBeTruthy();
    expect(within(cleanup).getByText(description)).toBeTruthy();
    expect(cleanup.textContent).toContain("not included in record totals");
    const table = screen.getByRole("table");
    expect(table.contains(cleanup)).toBe(false);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("Full-snapshot uploads").closest("tr")!.textContent).toBe("Full-snapshot uploads42504250");
  });
  it("keeps Accepted and Total when all counts are zero", async () => {
    render(
      React.createElement(ReverseTaskStatus, {
        task: task({
          version: 1,
          runId: "run",
          observedAt: "2026-01-01T00:00:00.000Z",
          upsert: counts,
          remove: counts,
          records: { accepted: 0, pending: 0, rejected: 0 },
          recordCounts: { upsert: counts, remove: counts },
        }),
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /PENDING/ }));
    const upload = (await screen.findByText("Additions / upserts")).closest("tr")!;
    expect(screen.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual([
      "Operation",
      "Accepted",
      "Total",
    ]);
    expect(
      within(upload)
        .getAllByRole("cell")
        .map(cell => cell.textContent)
    ).toEqual(["Additions / upserts", "0", "0"]);
    expect(screen.queryByRole("region", { name: "Full-mirror cleanup request" })).toBeNull();
  });
  it("does not present older batch counts as record counts", async () => {
    render(
      React.createElement(ReverseTaskStatus, {
        task: task({
          version: 1,
          runId: "run",
          observedAt: "2026-01-01T00:00:00.000Z",
          upsert: { ...counts, total: 1, accepted: 1 },
          remove: counts,
          records: { accepted: 64, pending: 0, rejected: 0 },
          replacement: "pending",
        }),
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /PENDING/ }));
    expect(await screen.findByText(/Record breakdown by operation is unavailable/)).toBeTruthy();
    expect(screen.getByText(/Records:/).textContent).toContain("64 accepted");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("region", { name: "Full-mirror cleanup request" }).textContent).toContain(
      "Waiting for Google"
    );
  });
  it("does not invent zero counts for attempts without statistics", async () => {
    render(React.createElement(ReverseTaskStatus, { task: task() }));
    fireEvent.click(screen.getByRole("button", { name: /PENDING/ }));
    expect(await screen.findByText(/Record statistics unavailable/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
