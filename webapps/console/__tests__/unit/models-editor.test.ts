// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ModelsPage from "../../pages/[workspaceId]/models";

const getComputedStyle = window.getComputedStyle.bind(window);

const state = vi.hoisted(() => ({
  enabled: true,
  models: [] as any[],
  reload: vi.fn(),
  route: {
    query: {} as Record<string, string>,
    pathname: "/[workspaceId]/models",
    events: { on: vi.fn(), off: vi.fn() },
    push: vi.fn(),
    replace: vi.fn(),
  },
  preview: vi.fn(),
  api: { list: vi.fn(), create: vi.fn(), update: vi.fn(), del: vi.fn() },
}));
vi.mock("juava", async importOriginal => ({ ...(await importOriginal<typeof import("juava")>()), rpc: state.preview }));
vi.mock("../../components/PageLayout/WorkspacePageLayout", () => ({
  WorkspacePageLayout: ({ children }: any) => children,
}));
vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slugOrId: "ws", featuresEnabled: state.enabled ? ["reverse-etl"] : [] }),
  useAppConfig: () => ({}),
  useWorkspaceRole: () => ({ role: "owner", editEntities: true, deleteEntities: true }),
}));
vi.mock("next/router", () => ({ useRouter: () => state.route }));
vi.mock("../../lib/ui", async original => ({
  ...(await original<typeof import("../../lib/ui")>()),
  useUnsavedChanges: () => {},
  useTitle: () => {},
}));
vi.mock("../../lib/modal", () => ({ useAntdModal: () => ({ confirm: vi.fn() }) }));
vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ value, onChange }: any) =>
      React.createElement("textarea", {
        "aria-label": "SQL editor",
        value,
        onChange: (e: any) => onChange(e.target.value),
      }),
}));
vi.mock("../../lib/useApi", () => ({ useConfigApi: () => state.api }));
vi.mock("../../lib/store", () => ({
  useConfigObjectList: (type: string) =>
    type === "model" ? state.models : [{ id: "wh", name: "Warehouse", destinationType: "postgres" }],
  useConfigObjectLinks: () => [],
  useStoreReload: () => state.reload,
  asConfigType: (type: string) => type,
  useConfigObjectMutation: (_type: string, fn: any) => ({ mutateAsync: fn }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.route.query = {};
  state.route.push.mockImplementation(async (url: any) => {
    state.route.query = typeof url === "string" ? {} : url.query;
  });
  state.preview.mockImplementation(async (url: string) =>
    url.includes("/config/link") ? { links: [] } : { columns: [], rows: [], truncated: false }
  );
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
  state.models = [
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
  ];
  state.reload.mockResolvedValue(undefined);
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
    const preview = {
      columns: [
        { name: "removed", type: "16", supportsDelete: true },
        { name: "flag_text", type: "25", supportsDelete: true },
        { name: "payload", type: "3802", supportsDelete: false },
        { name: "unknown", type: "custom" },
      ],
      rows: [],
      truncated: false,
    };
    state.preview.mockImplementation(async (url: string) => (url.includes("/config/link") ? { links: [] } : preview));
    state.route.query = { id: "model-1" };
    const client = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Preview up to 100 rows" }));
    await waitFor(() => expect(state.preview).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByLabelText("Delete column (optional)"));
    expect(await screen.findByRole("option", { name: "removed (16)" })).toBeTruthy();
    // Ant Design virtualizes the aria option list; visible items retain their title.
    expect(screen.getByTitle("flag_text (25)")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "payload (3802)" })).toBeNull();
    expect(screen.queryByRole("option", { name: "unknown (custom)" })).toBeNull();
    client.clear();
  });
  it("preserves an API-configured lookback when changing the name", async () => {
    state.route.query = { id: "model-1" };
    const client = mount();
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Renamed audience" } });
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
    expect(await screen.findByRole("link", { name: "Audience" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add new model" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button").at(-1)!);
    expect(await screen.findByText("Delete")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Delete/ }).getAttribute("aria-disabled")).not.toBe("true");
    expect(screen.getByRole("menuitem", { name: /Clone/ }).getAttribute("aria-disabled")).toBe("true");
    client.clear();
  });
  it("uses the standard object-list search and custom model columns", async () => {
    const client = mount();
    expect(await screen.findByRole("link", { name: "Audience" })).toBeTruthy();
    expect(screen.getByText("Primary key")).toBeTruthy();
    expect(screen.getByText("Incremental: changed")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Filter by ID or name..."), { target: { value: "no-match" } });
    await waitFor(() => expect(screen.queryByRole("link", { name: "Audience" })).toBeNull());
    client.clear();
  });
  it("opens Clone in the custom editor and creates a distinct model", async () => {
    state.route.query = { id: "new", clone: "model-1" };
    const client = mount();
    const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
    expect(name.value).toBe("Audience (copy)");
    expect(screen.getByLabelText("SQL editor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save model" }));
    await waitFor(() => expect(state.api.create).toHaveBeenCalled());
    expect(state.api.create.mock.calls[0][0]).toMatchObject({ name: "Audience (copy)", query: state.models[0].query });
    expect(state.api.create.mock.calls[0][0].id).not.toBe("model-1");
    await waitFor(() => expect(state.reload).toHaveBeenCalled());
    client.clear();
  });
});
