// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { ConfigEditor } from "../../components/ConfigObjectEditor/ConfigEditor";

const state = vi.hoisted(() => ({
  route: { query: { id: "new" } as Record<string, string>, push: vi.fn() },
  auth: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  source: {} as any,
}));
vi.mock("next/router", () => ({ useRouter: () => state.route }));
vi.mock("@nangohq/frontend", () => ({
  default: class {
    auth = state.auth;
  },
}));
vi.mock("../../lib/context", () => ({
  useWorkspace: () => ({ id: "ws", slugOrId: "ws" }),
  useWorkspaceRole: () => ({ editEntities: true }),
  useAppConfig: () => ({ nango: { publicKey: "test", host: "https://oauth.example.test" } }),
}));
vi.mock("../../lib/store", () => ({
  asConfigType: (type: string) => type,
  useConfigObject: () => state.source,
  useConfigObjectMutation: (_type: string, fn: any) => ({ mutateAsync: fn }),
  useStoreReload: () => async () => {},
}));
vi.mock("../../lib/useApi", () => ({ getConfigApi: () => ({ create: state.create, update: state.update }) }));
vi.mock("../../lib/ui", () => ({ useTitle() {}, feedbackError: vi.fn() }));
vi.mock("../../lib/modal", () => ({ useAntdModal: () => ({ error: vi.fn(), confirm: vi.fn() }) }));
vi.mock("../../components/ConfigObjectEditor/EditorBase", () => ({ EditorBase: ({ children }: any) => children }));
vi.mock("../../components/ConfigObjectEditor/EditorTitle", () => ({ EditorTitle: () => null }));
vi.mock("../../components/ConfigObjectEditor/Editors", () => ({ PasswordEditor: () => null }));
vi.mock("../../components/ConfigObjectEditor/EditorButtons", () => ({
  EditorButtons: ({ loading }: any) => React.createElement("button", { type: "submit", disabled: loading }, "Save"),
}));
vi.mock("../../components/JitsuButton/JitsuButton", () => ({
  JitsuButton: ({ children, onClick, loading }: any) =>
    React.createElement("button", { type: "button", onClick, disabled: loading }, children),
}));
// Keep the real editor's identity, OAuth callback, React state and save path;
// replace only the JSON-schema form renderer with an observable form boundary.
vi.mock("@rjsf/antd", () => ({
  Form: React.forwardRef(function MockConfigForm({ formData, onSubmit, onChange, children }: any, ref) {
    React.useImperativeHandle(ref, () => ({ state: { formData, errors: [] } }));
    return React.createElement(
      "form",
      {
        onSubmit: (e: any) => {
          e.preventDefault();
          onSubmit({ formData });
        },
      },
      React.createElement("output", { "data-testid": "form-data" }, JSON.stringify(formData)),
      React.createElement("input", {
        "aria-label": "Name",
        value: formData.name,
        onChange: (e: any) => onChange({ formData: { ...formData, name: e.target.value }, errors: [] }),
      }),
      children
    );
  }),
}));
const schema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: z.string(),
  name: z.string(),
  destinationType: z.string(),
  authorized: z.boolean().optional(),
  oauthConnectionId: z.string().optional(),
  oauthIntegrationId: z.string().optional(),
});
const props = {
  explanation: "Test destination",
  type: "destination",
  noun: "destination",
  objectType: schema,
  fields: {},
  newObject: (): Partial<z.infer<typeof schema>> => ({ name: "Google", destinationType: "google-ads" }),
};
const form = () => JSON.parse(screen.getByTestId("form-data").textContent!);
beforeEach(() => {
  vi.clearAllMocks();
  state.route.query = { id: "new" };
  state.auth.mockResolvedValue({});
  state.create.mockResolvedValue({});
  state.update.mockResolvedValue({});
  state.source = {
    id: "original",
    workspaceId: "ws",
    type: "destination",
    name: "Google",
    destinationType: "google-ads",
    authorized: true,
    oauthConnectionId: "destination.original",
    oauthIntegrationId: "jitsu-cloud-dst-google-ads",
  };
});
afterEach(cleanup);

it("keeps a new destination ID stable through rerenders, OAuth, and saving", async () => {
  const view = render(React.createElement(ConfigEditor, props));
  await screen.findByTestId("form-data");
  const id = form().id;
  view.rerender(React.createElement(ConfigEditor, { ...props }));
  expect(form().id).toBe(id);
  fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
  await screen.findByRole("button", { name: "Re-Sign In" });
  expect(state.auth).toHaveBeenCalledWith("jitsu-cloud-dst-google-ads", `destination.${id}`);
  view.rerender(React.createElement(ConfigEditor, { ...props }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({ id, authorized: true, oauthConnectionId: `destination.${id}` })
    )
  );
});

it("preserves edits made while OAuth is pending and blocks saving until it completes", async () => {
  let finish!: (result: unknown) => void;
  state.auth.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  render(React.createElement(ConfigEditor, props));
  fireEvent.click(await screen.findByRole("button", { name: "Authorize" }));
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
  finish({});
  await screen.findByRole("button", { name: "Re-Sign In" });
  expect(form().name).toBe("Renamed");
});

it("gives a clone a stable new ID and requires its own OAuth authorization", async () => {
  state.route.query = { id: "new", clone: "original" };
  const view = render(React.createElement(ConfigEditor, props));
  await screen.findByTestId("form-data");
  const id = form().id;
  expect(id).not.toBe("original");
  expect(form().authorized).toBe(false);
  expect(form().oauthConnectionId).toBeUndefined();
  view.rerender(React.createElement(ConfigEditor, { ...props }));
  expect(form().id).toBe(id);
  fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
  await screen.findByRole("button", { name: "Re-Sign In" });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ id, oauthConnectionId: `destination.${id}` }))
  );
  expect(state.source.oauthConnectionId).toBe("destination.original");
});

it("reauthorizes an existing mismatched destination under its saved ID", async () => {
  state.route.query = { id: "original" };
  state.source.oauthConnectionId = "destination.wrong";
  render(React.createElement(ConfigEditor, props));
  fireEvent.click(await screen.findByRole("button", { name: "Re-Sign In" }));
  await waitFor(() => expect(form().oauthConnectionId).toBe("destination.original"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(state.update).toHaveBeenCalledWith(
      "original",
      expect.objectContaining({ id: "original", oauthConnectionId: "destination.original" })
    )
  );
});

it("starts a fresh draft when navigating to another clone", async () => {
  state.route.query = { id: "new", clone: "original" };
  const view = render(React.createElement(ConfigEditor, props));
  await screen.findByTestId("form-data");
  const id = form().id;
  state.route.query = { id: "new", clone: "other" };
  state.source = { ...state.source, id: "other", name: "Other" };
  view.rerender(React.createElement(ConfigEditor, props));
  await waitFor(() => expect(form().id).not.toBe(id));
  expect(form().name).toBe("Other (copy)");
});
