// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReverseTasksList } from "../../components/ReverseETL/TasksList";
import { ReverseSyncsList } from "../../components/ReverseETL/SyncsList";
import { ReverseRuns } from "../../components/ReverseETL/Runs";

const state = vi.hoisted(() => ({
  route: { query: {} as Record<string, string>, isReady: true, push: vi.fn(), replace: vi.fn() },
  rpc: vi.fn(),
  refetch: vi.fn(),
  confirm: vi.fn(),
  enabled: true,
  syncs: [] as any[],
}));
vi.mock("next/router", () => ({ useRouter: () => state.route }));
vi.mock("juava", async original => ({ ...(await original<typeof import("juava")>()), rpc: state.rpc }));
vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slugOrId: "ws", featuresEnabled: state.enabled ? ["reverse-etl"] : [] }),
  useAppConfig: () => ({}),
  useWorkspaceRole: () => ({ role: "owner" }),
}));
vi.mock("../../lib/store", () => ({
  useConfigObjectList: (type: string) =>
    type === "model"
      ? [{ id: "model", name: "Audience", warehouseId: "warehouse" }]
      : [
          { id: "destination", name: "Google", destinationType: "google-ads" },
          { id: "warehouse", name: "Source", destinationType: "postgres" },
        ],
}));
vi.mock("../../lib/ui", () => ({ confirmOp: state.confirm }));
vi.mock("../../components/ReverseETL/shared", async original => ({
  ...(await original<typeof import("../../components/ReverseETL/shared")>()),
  useReverseSyncs: () => ({ data: state.syncs, refetch: state.refetch }),
}));
vi.mock("../../pages/[workspaceId]/destinations", () => ({ DestinationTitle: () => "Google" }));
// Shared controls have separate permission/navigation behavior. Expose the action
// descriptors here so these tests exercise the reverse list's own guards and calls.
vi.mock("../../components/ButtonGroup/ButtonGroup", () => ({
  ButtonGroup: ({ items }: any) =>
    React.createElement(
      "div",
      {},
      items.map((item: any) =>
        React.createElement("button", { key: item.label, disabled: item.disabled, onClick: item.onClick }, item.label)
      )
    ),
}));
const getComputedStyle = window.getComputedStyle.bind(window);
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  state.route.query = {};
  state.enabled = true;
  state.confirm.mockResolvedValue(true);
  state.refetch.mockResolvedValue(undefined);
  state.route.push.mockResolvedValue(true);
  state.route.replace.mockResolvedValue(true);
  state.syncs = [
    {
      id: "sync",
      fromId: "model",
      toId: "destination",
      modelName: "Audience",
      destinationName: "Google",
      options: { name: "Customers", mode: "mirror", streamOptions: {}, disabled: false, schedule: "" },
      latestTask: null,
    },
  ];
  state.rpc.mockResolvedValue({
    tasks: [
      {
        task_id: "task",
        sync_id: "sync",
        status: "SUCCESS",
        started_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:10Z",
        description: null,
        error: null,
        trigger: "manual",
      },
    ],
  });
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
  clients.splice(0).forEach(c => c.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(component: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(React.createElement(QueryClientProvider, { client }, React.createElement(component)));
}
describe("Reverse ETL standard lists", () => {
  it("shows a plain status tag and expanded record statistics on the logs page", async () => {
    state.route.query = { syncId: "sync", taskId: "task" };
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
    state.rpc.mockResolvedValue({
      tasks: [
        {
          task_id: "task",
          sync_id: "sync",
          status: "PENDING",
          started_at: new Date(),
          updated_at: new Date(),
          description: null,
          error: null,
          stats: {
            version: 1,
            runId: "run",
            observedAt: "2026-01-01T00:00:00.000Z",
            upsert: { ...counts, total: 1, pending: 1 },
            remove: counts,
            records: { accepted: 0, pending: 100, rejected: 0 },
            recordCounts: { upsert: { ...counts, total: 100, pending: 100 }, remove: counts },
          },
        },
      ],
      logs: [],
    });
    const { container } = mount(ReverseRuns);
    expect(await screen.findByText("Additions / upserts")).toBeTruthy();
    expect(screen.getByText("PENDING").classList.contains("ant-tag-green")).toBe(true);
    expect(screen.getByText(/Records:/).textContent).toContain("100 pending");
    expect(screen.queryByRole("button", { name: /PENDING/ })).toBeNull();
    expect(screen.queryByText("show stats")).toBeNull();
    expect(screen.queryByRole("link", { name: "Show Logs" })).toBeNull();
    expect(container.querySelector(".lucide-chevron-down")).toBeNull();
  });
  it("uses only endpoints as the title and greys disabled rows without mode or schedule labels", () => {
    state.syncs[0].options.disabled = true;
    state.syncs[0].options.schedule = "0 * * * *";
    const { container } = mount(ReverseSyncsList);
    expect(container.querySelector(".ant-table-small")).toBeNull();
    expect((container.querySelector(".ant-table-content") as HTMLElement).style.overflowX).not.toBe("auto");
    expect(screen.getByText("Audience").closest("tr")?.classList.contains("opacity-50")).toBe(true);
    for (const label of ["Customers", "Mirror", "0 * * * *", "PAUSED", "ENABLED", "Manual only"])
      expect(screen.queryByText(label)).toBeNull();
  });
  it("passes bookmarked filters to the server and changes status without losing other filters", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-01-01T00:02:10Z"));
    state.route.query = { syncId: "sync", status: "SUCCESS", from: "2026-01-01T00:00:00.000Z" };
    const { container } = mount(ReverseTasksList);
    await screen.findByText("2m ago");
    expect(screen.getByRole("columnheader", { name: "Updated At" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Duration" })).toBeNull();
    expect((container.querySelector(".ant-table-content") as HTMLElement).style.overflowX).not.toBe("auto");
    expect(screen.getByText("Syncs:")).toBeTruthy();
    expect(screen.getByText("Statuses:")).toBeTruthy();
    expect(screen.getByText("Date range:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back", exact: true })).toBeTruthy();
    expect(screen.queryByText(/Customers/)).toBeNull();
    expect(state.rpc).toHaveBeenCalledWith("/api/ws/reverse-etl/tasks", { query: state.route.query });
    fireEvent.mouseDown(screen.getAllByRole("combobox")[1]);
    fireEvent.click(await screen.findByText("FAILED", { selector: ".ant-tag" }));
    expect(state.route.push).toHaveBeenCalledWith(
      { pathname: "/ws/reverse-syncs/tasks", query: { ...state.route.query, status: "FAILED" } },
      undefined,
      { shallow: true }
    );
  });
  it("opens a new attempt's logs through client navigation after Run", async () => {
    mount(ReverseSyncsList);
    state.rpc.mockResolvedValue({ taskId: "new-task", status: "started" });
    fireEvent.click(screen.getByRole("button", { name: "Run", exact: true }));
    await waitFor(() =>
      expect(state.route.push).toHaveBeenCalledWith("/ws/reverse-syncs/logs?syncId=sync&taskId=new-task")
    );
    expect(state.rpc).toHaveBeenCalledWith("/api/ws/reverse-etl/sync", {
      query: { syncId: "sync" },
      method: "POST",
      body: { action: "run" },
    });
  });
  it("keeps cancellation available with rollout disabled but disallows another run", async () => {
    state.enabled = false;
    state.rpc.mockResolvedValue({
      tasks: [
        {
          task_id: "task",
          sync_id: "sync",
          status: "WAITING",
          started_at: new Date(),
          updated_at: new Date(),
          description: null,
          error: null,
        },
      ],
    });
    mount(ReverseTasksList);
    const cancel = await screen.findByRole("button", { name: "Cancel", exact: true });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith("/api/ws/reverse-etl/sync", {
        method: "POST",
        query: { syncId: "sync" },
        body: { action: "cancel", taskId: "task" },
      })
    );
    cleanup();
    mount(ReverseSyncsList);
    expect((screen.getByRole("button", { name: "Run", exact: true }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Pause", exact: true }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("refreshes a failed task by its existing ID instead of starting a new run", async () => {
    state.rpc.mockResolvedValue({
      tasks: [
        {
          task_id: "original-task",
          sync_id: "sync",
          status: "FAILED",
          canRefresh: true,
          started_at: new Date(),
          updated_at: new Date(),
          description: null,
          error: "Lookup failed",
        },
      ],
    });
    mount(ReverseTasksList);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh status", exact: true }));
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith("/api/ws/reverse-etl/sync", {
        method: "POST",
        query: { syncId: "sync" },
        body: { action: "refresh", taskId: "original-task" },
      })
    );
    expect(state.route.push).not.toHaveBeenCalled();
  });
});
