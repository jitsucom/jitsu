// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MetaTargetCheck } from "../../components/ReverseETL/MetaTargetCheck";
import { DestinationTargetSelector } from "../../components/ReverseETL/DestinationTargetSelector";
import { metaAudienceEditor } from "@jitsu/destination-functions/src/functions/facebook/editor";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("juava", async original => ({ ...(await original<typeof import("juava")>()), rpc }));
vi.mock("../../lib/context", () => ({ useWorkspace: () => ({ id: "ws" }) }));
beforeEach(() => {
  rpc.mockReset();
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
function wrapper({ children }: React.PropsWithChildren) {
  return React.createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children
  );
}
it("checks only on request and discards success when target settings change", async () => {
  rpc.mockResolvedValue({ name: "First pixel", message: "Read access" });
  const view = render(
    React.createElement(MetaTargetCheck, {
      destinationId: "meta",
      stream: "conversions",
      streamOptions: { pixelId: "789" },
      disabled: false,
    }),
    { wrapper }
  );
  expect(rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check Meta connection" }));
  await screen.findByText("Target verified: First pixel");
  view.rerender(
    React.createElement(MetaTargetCheck, {
      destinationId: "meta",
      stream: "conversions",
      streamOptions: { pixelId: "790" },
      disabled: false,
    })
  );
  expect(screen.queryByText("Target verified: First pixel")).toBeNull();
});
it("a late response for an old target cannot verify the new target", async () => {
  let finish!: (value: unknown) => void;
  rpc.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const view = render(
    React.createElement(MetaTargetCheck, {
      destinationId: "meta",
      stream: "conversions",
      streamOptions: { pixelId: "789" },
      disabled: false,
    }),
    { wrapper }
  );
  fireEvent.click(screen.getByRole("button", { name: "Check Meta connection" }));
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  view.rerender(
    React.createElement(MetaTargetCheck, {
      destinationId: "meta",
      stream: "conversions",
      streamOptions: { pixelId: "790" },
      disabled: false,
    })
  );
  finish({ name: "Old pixel", message: "Read access" });
  await waitFor(() => expect(screen.queryByText("Target verified: Old pixel")).toBeNull());
});
it("keeps manual IDs editable when lookup fails and shows the safe diagnostic", async () => {
  rpc.mockRejectedValue(new Error("Meta access token is invalid or expired"));
  const change = vi.fn();
  render(
    React.createElement(DestinationTargetSelector, {
      destinationId: "meta",
      kind: "meta-account",
      value: "123",
      disabled: false,
      onChange: change,
    }),
    { wrapper }
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await screen.findByText(/Meta access token is invalid or expired/);
  fireEvent.change(input, { target: { value: "124" } });
  expect(change.mock.calls[0][0]).toBe("124");
});
it("scopes audience discovery to the selected account and value-based mode", async () => {
  rpc.mockResolvedValue({ options: [] });
  const view = render(
    React.createElement(DestinationTargetSelector, {
      destinationId: "meta",
      kind: "meta-audience",
      lookupParams: { accountId: "123", valueBased: "false" },
      value: "",
      disabled: false,
      onChange: () => {},
    }),
    { wrapper }
  );
  fireEvent.focus(screen.getByRole("combobox"));
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      "/api/ws/reverse-etl/options",
      expect.objectContaining({
        query: { destinationId: "meta", kind: "meta-audience", accountId: "123", valueBased: "false" },
      })
    )
  );
  view.rerender(
    React.createElement(DestinationTargetSelector, {
      destinationId: "meta",
      kind: "meta-audience",
      lookupParams: { accountId: "124", valueBased: "true" },
      value: "",
      disabled: false,
      onChange: () => {},
    })
  );
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      "/api/ws/reverse-etl/options",
      expect.objectContaining({
        query: { destinationId: "meta", kind: "meta-audience", accountId: "124", valueBased: "true" },
      })
    )
  );
});
it("does not browse audiences before an account is chosen", () => {
  render(
    React.createElement(DestinationTargetSelector, {
      destinationId: "meta",
      kind: "meta-audience",
      lookupParams: { accountId: "" },
      value: "456",
      disabled: false,
      onChange: () => {},
    }),
    { wrapper }
  );
  fireEvent.focus(screen.getByRole("combobox"));
  expect(rpc).not.toHaveBeenCalled();
  expect(screen.getByText(/Choose an ad account/)).toBeTruthy();
});
it("clears an existing-audience selection when the account changes", () => {
  const field = metaAudienceEditor
    .fields({
      mode: "upsert",
      mapping: {},
      streamOptions: { accountId: "123", audience: { kind: "existing", audienceId: "456" } },
    })
    .find(f => f.name === "Ad account ID")!;
  if (field.editor !== "target") throw new Error("Expected target picker");
  expect(field.change("124")).toMatchObject({
    streamOptions: { accountId: "124", audience: { kind: "existing", audienceId: "" } },
  });
});
