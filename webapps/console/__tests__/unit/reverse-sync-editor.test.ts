// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SyncEditor } from "../../components/ReverseETL/SyncEditor";
import { ReverseSyncView } from "../../lib/reverse-etl";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  route: { query: { id: "new" } as Record<string, string>, push: vi.fn(), replace: vi.fn() },
  models: [] as { id: string; name: string; warehouseId: string; query: string }[],
}));
vi.mock("juava", async original => ({ ...(await original<typeof import("juava")>()), rpc: state.rpc }));
vi.mock("next/router", () => ({ useRouter: () => state.route }));
vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slugOrId: "ws", featuresEnabled: ["reverse-etl"] }),
  useWorkspaceRole: () => ({ editEntities: true, deleteEntities: true }),
  useAppConfig: () => ({}),
}));
vi.mock("../../lib/ui", () => ({ useUnsavedChanges() {}, confirmOp: vi.fn() }));
vi.mock("../../lib/store", () => ({
  useConfigObjectList: (type: string) =>
    type === "model" ? state.models : [{ id: "google", destinationType: "google-ads" }],
}));
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
  state.models = [];
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
function mount(sync?: ReverseSyncView) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      React.createElement(SyncEditor, { sync, reload: async () => {} })
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
  await waitFor(() => expect(state.route.push).toHaveBeenCalledWith("/ws/reverse-syncs"));
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

function savedSync() {
  return ReverseSyncView.parse({
    id: "saved",
    fromId: "model1",
    toId: "google",
    modelName: "Model",
    destinationName: "Google",
    options: {
      name: "Audience",
      stream: "audience",
      mode: "upsert",
      mapping: { email: "old_email" },
      streamOptions: { audience: { kind: "existing", audienceId: "123" }, customerMatchTermsAccepted: true },
    },
    settingsLocked: false,
    latestTask: null,
    phase: null,
  });
}
it("returns to the list after editing a saved sync", async () => {
  state.rpc.mockResolvedValue({ id: "saved" });
  mount(savedSync());
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.route.push).toHaveBeenCalledWith("/ws/reverse-syncs"));
  expect(state.rpc).toHaveBeenCalledWith(
    expect.stringContaining("syncId=saved"),
    expect.objectContaining({ method: "PUT" })
  );
});
it("keeps saved mappings visible when column discovery fails", async () => {
  state.models = [{ id: "model1", name: "Model", warehouseId: "wh", query: "select email" }];
  state.rpc.mockRejectedValue(new Error("Warehouse unavailable"));
  mount(savedSync());
  await screen.findByText("Could not load model columns. Existing mappings are kept.");
  expect(screen.getByTestId("Email column").textContent).toContain("old_email");
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
});
it("loads model columns for identifiers and consent and refreshes on model selection", async () => {
  state.models = [
    { id: "model1", name: "First model", warehouseId: "wh", query: "select email" },
    { id: "model2", name: "Second model", warehouseId: "wh", query: "select contact" },
  ];
  state.rpc.mockImplementation(async (_url: string, args: any) => ({
    columns:
      args.query.modelId === "model1"
        ? [
            { name: "email_address", type: "text" },
            { name: "consent", type: "text" },
          ]
        : [{ name: "contact", type: "text" }],
  }));
  mount(savedSync());
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "/api/ws/models/columns",
      expect.objectContaining({ query: { modelId: "model1" } })
    )
  );
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "email column" }));
  await waitFor(() => expect(screen.getAllByTitle("text")).toHaveLength(2));
  fireEvent.click(screen.getAllByText("email_address").at(-1)!);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Ad user data consent column" }));
  expect(screen.getAllByText("consent").length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByText("consent").at(-1)!);
  fireEvent.mouseDown(within(screen.getByTestId("Model")).getByRole("combobox"));
  fireEvent.click(screen.getByTitle("Second model"));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "/api/ws/models/columns",
      expect.objectContaining({ query: { modelId: "model2" } })
    )
  );
  const email = screen.getByRole("combobox", { name: "email column" });
  fireEvent.focus(email);
  fireEvent.keyDown(email, { key: "ArrowDown", code: "ArrowDown", keyCode: 40 });
  await waitFor(() => expect(screen.getAllByText("contact").length).toBeGreaterThan(0));
  // Existing mapping is not silently cleared by the model switch.
  expect(screen.getAllByText("email_address").length).toBeGreaterThan(0);
});
