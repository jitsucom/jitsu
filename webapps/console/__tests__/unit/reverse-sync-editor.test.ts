// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SyncEditor } from "../../components/ReverseETL/SyncEditor";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  route: { query: { id: "new" } as Record<string, string>, push: vi.fn(), replace: vi.fn() },
  api: { list: vi.fn(async () => []) },
}));
vi.mock("juava", async original => ({ ...(await original<typeof import("juava")>()), rpc: state.rpc }));
vi.mock("next/router", () => ({ useRouter: () => state.route }));
vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slugOrId: "ws", featuresEnabled: ["reverse-etl"] }),
  useWorkspaceRole: () => ({ editEntities: true, deleteEntities: true }),
  useAppConfig: () => ({}),
}));
vi.mock("../../lib/ui", () => ({ useUnsavedChanges() {}, confirmOp: vi.fn() }));
vi.mock("../../lib/useApi", () => ({ useConfigApi: () => state.api }));
vi.mock("../../lib/store", () => ({ useConfigObjectList: () => [] }));
vi.mock("../../components/Selectors/DestinationSelector", () => ({ DestinationSelector: () => null }));
vi.mock("../../components/BackButton/BackButton", () => ({ BackButton: () => null }));
vi.mock("../../components/EditorToolbar/EditorToolbar", () => ({ EditorToolbar: () => null }));
vi.mock("../../components/FieldListEditorLayout/FieldListEditorLayout", () => ({
  default: ({ items }: any) =>
    React.createElement(
      React.Fragment,
      null,
      ...items.map((item: any) =>
        React.createElement("div", { key: item.name ?? item.key, "data-testid": item.name }, item.component)
      )
    ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.route.query = { id: "new" };
  state.route.replace.mockImplementation(async ({ query }: any) => {
    state.route.query = query;
  });
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
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      React.createElement(SyncEditor, { reload: async () => {} })
    )
  );
}

it("reuses the URL save key after an uncertain create and page reload", async () => {
  state.rpc.mockRejectedValue(new Error("Response lost"));
  const first = mount();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  const key = state.rpc.mock.calls[0][1].body.requestId;
  expect(state.route.query.requestId).toBe(key);
  first.unmount();
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  expect(state.rpc.mock.calls[1][1].body.requestId).toBe(key);
});

it("disables fields while Save is pending", async () => {
  let finish!: (value: unknown) => void;
  state.rpc.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("Name").querySelector("input")?.disabled).toBe(true);
  finish({ id: "saved" });
  await waitFor(() => expect(state.route.push).toHaveBeenCalledWith("/ws/reverse-syncs?id=saved"));
});

it("opens the committed sync when Run after save cannot be confirmed", async () => {
  state.rpc.mockResolvedValueOnce({ id: "saved" }).mockRejectedValueOnce(new Error("Controller unavailable"));
  mount();
  fireEvent.click(screen.getByRole("checkbox", { name: "Run sync after save" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(state.route.push).toHaveBeenCalledWith("/ws/reverse-syncs?id=saved&runStartUnconfirmed=1")
  );
  expect(state.rpc).toHaveBeenCalledTimes(2);
});
