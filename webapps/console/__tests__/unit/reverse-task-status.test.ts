// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ReverseTaskStatus } from "../../components/ReverseETL/TaskStatus";
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
  it("shows each outcome against its batch type total and keeps cleanup separate", async () => {
    render(
      React.createElement(ReverseTaskStatus, {
        task: task({
          version: 1,
          runId: "run",
          observedAt: "2026-01-01T00:00:00.000Z",
          upsert: { ...counts, total: 4, accepted: 3, pending: 1 },
          remove: { ...counts, total: 2, rejected: 2 },
          records: { accepted: 300, pending: 100, rejected: 20 },
          replacement: "pending",
        }),
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /WAITING/ }));
    const upload = (await screen.findByText("Full-snapshot uploads")).closest("tr")!;
    expect(within(upload).getByText("3 / 4")).toBeTruthy();
    expect(within(upload).getByText("1 / 4")).toBeTruthy();
    expect(within(screen.getByText("Removals").closest("tr")!).getByText("2 / 2")).toBeTruthy();
    expect(screen.getByText(/Full-audience cleanup:/).textContent).toContain("separate request, not a removal batch");
    expect(screen.getByText(/Records:/).textContent).toContain("300 accepted");
    expect(screen.getByRole("link", { name: "Show Logs" }).getAttribute("href")).toBe(
      "/reverse-syncs/logs?syncId=sync&taskId=task"
    );
  });
  it("does not invent zero counts for older attempts", async () => {
    render(React.createElement(ReverseTaskStatus, { task: task() }));
    fireEvent.click(screen.getByRole("button", { name: /WAITING/ }));
    expect(await screen.findByText(/Batch statistics unavailable/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
