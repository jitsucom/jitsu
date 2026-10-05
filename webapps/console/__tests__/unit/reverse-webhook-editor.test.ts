// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    type === "model" ? state.models : [{ id: "hook", destinationType: "webhook" }],
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
  state.route.query = { id: "new", modelId: "model1", destinationId: "hook" };
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

const twoColumns = [
  { name: "id", type: "int4" },
  { name: "name", type: "text" },
];
const models = [{ id: "model1", name: "Users", warehouseId: "wh", query: "select id, name from users" }];
function columnsFor(columns: { name: string; type: string }[]) {
  state.rpc.mockImplementation(async (url: string) =>
    url.endsWith("/models/columns") ? { columns } : { id: "saved", sync: { id: "saved" } }
  );
}
async function chooseRows() {
  fireEvent.mouseDown(within(screen.getByTestId("Stream")).getByRole("combobox"));
  fireEvent.click(await screen.findByTitle("Rows"));
}
const saveBody = () => state.rpc.mock.calls.find(([, args]) => args?.method === "POST")?.[1].body.sync;

it("lists only the Rows stream and defaults to upsert with checkpointEvery 5000", async () => {
  state.models = models;
  columnsFor(twoColumns);
  mount();
  await chooseRows();
  await waitFor(() => expect(screen.getByLabelText("Payload preview")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveBody()).toBeTruthy());
  expect(saveBody().data).toMatchObject({
    stream: "rows",
    mode: "upsert",
    checkpointEvery: 5000,
    streamOptions: { recordsPerRequest: 50, concurrency: 2, deliveryAttested: false },
  });
});

it("writes the identity mapping for every model column and shows a payload preview", async () => {
  state.models = models;
  columnsFor(twoColumns);
  mount();
  await chooseRows();
  const preview = await screen.findByLabelText("Payload preview");
  expect(preview.textContent).toContain('"id": <int4>');
  expect(preview.textContent).toContain('"name": <text>');
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveBody()).toBeTruthy());
  expect(saveBody().data.mapping).toEqual({ id: "id", name: "name" });
});

it("follows the model's columns when the model changes, dropping columns that are gone", async () => {
  state.models = [
    ...models,
    { id: "model2", name: "Orders", warehouseId: "wh", query: "select id, total from orders" },
  ];
  state.rpc.mockImplementation(async (url: string, args: any) =>
    url.endsWith("/models/columns")
      ? {
          columns:
            args.query.modelId === "model1"
              ? twoColumns
              : [
                  { name: "id", type: "int4" },
                  { name: "total", type: "numeric" },
                ],
        }
      : { id: "saved", sync: { id: "saved" } }
  );
  mount();
  await chooseRows();
  await screen.findByText(/"name": <text>/);
  fireEvent.mouseDown(within(screen.getByTestId("Model")).getByRole("combobox"));
  fireEvent.click(screen.getByTitle("Orders"));
  await screen.findByText(/"total": <numeric>/);
  // The preview is up, so the mapping effect has run; let its state update settle before saving.
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveBody()).toBeTruthy());
  expect(saveBody().data.mapping).toEqual({ id: "id", total: "total" });
});

it("keeps a saved mapping when the columns cannot be loaded", async () => {
  state.models = models;
  state.rpc.mockImplementation(async (url: string) => {
    if (url.endsWith("/models/columns")) throw new Error("Warehouse unavailable");
    return { id: "saved" };
  });
  mount(
    ReverseSyncView.parse({
      id: "saved",
      fromId: "model1",
      toId: "hook",
      modelName: "Users",
      destinationName: "Hook",
      options: {
        stream: "rows",
        mode: "upsert",
        mapping: { id: "id", name: "name" },
        streamOptions: { recordsPerRequest: 50, concurrency: 2, deliveryAttested: true },
      },
      settingsLocked: false,
      latestTask: null,
      phase: null,
    })
  );
  await screen.findByText("Could not load model columns. Existing mappings are kept.");
  expect(screen.getByLabelText("Payload preview").textContent).toContain('"name": ...');
  await act(async () => {});
  expect(
    (screen.getByRole("checkbox", { name: /tolerates receiving the same record more than once/ }) as HTMLInputElement)
      .checked
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      expect.stringContaining("syncId=saved"),
      expect.objectContaining({ method: "PUT" })
    )
  );
  const put = state.rpc.mock.calls.find(([, args]) => args?.method === "PUT")![1].body;
  expect(put.data.mapping).toEqual({ id: "id", name: "name" });
});

it("sends the repeated-delivery and unencrypted-HTTP confirmations the user ticks", async () => {
  state.models = models;
  columnsFor(twoColumns);
  mount();
  await chooseRows();
  await screen.findByLabelText("Payload preview");
  const attest = () =>
    screen.getByRole("checkbox", { name: /tolerates receiving the same record more than once/ }) as HTMLInputElement;
  const insecure = () =>
    screen.getByRole("checkbox", { name: /accept sending data over unencrypted http/ }) as HTMLInputElement;
  expect([attest().checked, insecure().checked]).toEqual([false, false]);
  fireEvent.click(attest());
  fireEvent.click(insecure());
  expect([attest().checked, insecure().checked]).toEqual([true, true]);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveBody()).toBeTruthy());
  expect(saveBody().data.streamOptions).toMatchObject({ deliveryAttested: true, allowInsecureHttp: true });
});

it("explains at-least-once delivery, the size limit, type conversion and HTTPS", async () => {
  state.models = models;
  columnsFor(twoColumns);
  mount();
  await chooseRows();
  const notice = (await screen.findByTestId("How delivery works")).textContent!;
  for (const text of ["at least once", "stops at that record", "1 MiB", "base64", "https://"]) {
    expect(notice).toContain(text);
  }
});
