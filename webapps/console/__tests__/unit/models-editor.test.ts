// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ModelsPage from "../../pages/[workspaceId]/models";

const getComputedStyle = window.getComputedStyle.bind(window);

const state = vi.hoisted(() => ({
  enabled: true,
  preview: vi.fn(),
  api: { list: vi.fn(), create: vi.fn(), update: vi.fn(), del: vi.fn() },
}));
vi.mock("juava", async importOriginal => ({ ...(await importOriginal<typeof import("juava")>()), rpc: state.preview }));
vi.mock("../../components/PageLayout/WorkspacePageLayout", () => ({
  WorkspacePageLayout: ({ children }: any) => children,
}));
vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", featuresEnabled: state.enabled ? ["reverse-etl"] : [] }),
  useWorkspaceRole: () => ({ editEntities: true, deleteEntities: true }),
}));
vi.mock("../../lib/useApi", () => ({ useConfigApi: () => state.api }));
vi.mock("../../lib/store", () => ({
  useConfigObjectList: () => [{ id: "wh", name: "Warehouse", destinationType: "postgres" }],
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => getComputedStyle(element));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  window.matchMedia = vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  state.api.list.mockResolvedValue([
    {
      id: "model-1",
      name: "Audience",
      type: "model",
      workspaceId: "ws",
      warehouseId: "wh",
      query: "SELECT id, changed FROM audience",
      primaryKey: ["id"],
      pageSize: 1000,
      cursor: { column: "changed", type: "timestamp", lookbackSeconds: 60 },
    },
  ]);
  state.api.update.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(React.createElement(QueryClientProvider, { client }, React.createElement(ModelsPage)));
  return client;
}

describe("model editor", () => {
  it("offers only delete-compatible preview columns in the delete picker", async () => {
    state.preview.mockResolvedValue({
      columns: [
        { name: "removed", type: "16", supportsDelete: true },
        { name: "flag_text", type: "25", supportsDelete: true },
        { name: "payload", type: "3802", supportsDelete: false },
        { name: "unknown", type: "custom" },
      ],
      rows: [],
      truncated: false,
    });
    const client = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Audience" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview up to 100 rows" }));
    await waitFor(() => expect(state.preview).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByLabelText("Delete column (optional)"));
    expect(await screen.findByRole("option", { name: "removed (16)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "flag_text (25)" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "payload (3802)" })).toBeNull();
    expect(screen.queryByRole("option", { name: "unknown (custom)" })).toBeNull();
    client.clear();
  });
  it("preserves an API-configured lookback when changing the name", async () => {
    const client = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Audience" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed audience" } });
    fireEvent.click(screen.getByRole("button", { name: "Save model" }));
    await waitFor(() =>
      expect(state.api.update).toHaveBeenCalledWith(
        "model-1",
        expect.objectContaining({
          name: "Renamed audience",
          cursor: { column: "changed", type: "timestamp", lookbackSeconds: 60 },
        })
      )
    );
    client.clear();
  });
  it("lists existing models for cleanup without enabling creation", async () => {
    state.enabled = false;
    const client = mount();
    expect(screen.getByText("Reverse ETL is not enabled for this workspace")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Audience" })).toBeTruthy();
    expect(state.api.list).toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "New model" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Audience" }));
    expect(screen.getByText("View model")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save model" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Preview up to 100 rows" }) as HTMLButtonElement).disabled).toBe(true);
    client.clear();
  });
});
