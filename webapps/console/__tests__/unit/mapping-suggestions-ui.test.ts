// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import { MappingSuggestions } from "../../components/ReverseETL/MappingSuggestions";
import { rpc } from "juava";

vi.mock("juava", async importOriginal => ({ ...(await importOriginal<typeof import("juava")>()), rpc: vi.fn() }));
const stream = reverseDestinationMetadata.get("google-ads")!.streams.find(s => s.id === "audience")!;
const columns = [{ name: "email", type: "text" }];
const response = {
  columns,
  suggestions: [
    {
      id: "mapping:email",
      label: "Email",
      confidence: 0.95,
      noMatch: false,
      recommended: { key: "email", column: "email", format: "raw", probability: 0.98 },
      alternatives: [{ key: "email", column: "email", format: "raw", probability: 0.98 }],
    },
  ],
};
function props() {
  return {
    workspaceId: "workspace",
    modelId: "model",
    destinationId: "destination",
    stream,
    options: stream.defaults(),
    columns,
    disabled: false,
    onApply: vi.fn(),
  };
}
beforeEach(() => {
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
  vi.mocked(rpc).mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("reviews suggestions before changing the form", async () => {
  vi.mocked(rpc).mockResolvedValue(response);
  const p = props();
  render(React.createElement(MappingSuggestions, p));
  fireEvent.click(screen.getByRole("button", { name: "Suggest mappings" }));
  await screen.findByText("Review suggested mappings");
  expect(p.onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply selected mappings" }));
  expect(p.onApply).toHaveBeenCalledWith({ email: "email" });
});

it("does not preselect ambiguous mappings", async () => {
  vi.mocked(rpc).mockResolvedValue({
    ...response,
    suggestions: response.suggestions.map(s => ({ ...s, recommended: null, confidence: 0.4 })),
  });
  render(React.createElement(MappingSuggestions, props()));
  fireEvent.click(screen.getByRole("button", { name: "Suggest mappings" }));
  await screen.findByText("Needs review");
  expect(screen.getByRole("button", { name: "Apply selected mappings" }).hasAttribute("disabled")).toBe(true);
});

it("distinguishes confidence in no match from confidence in an alternative", async () => {
  vi.mocked(rpc).mockResolvedValue({
    ...response,
    suggestions: response.suggestions.map(s => ({
      ...s,
      recommended: null,
      noMatch: true,
      confidence: 0.95,
      alternatives: s.alternatives.map(c => ({ ...c, probability: 0.02 })),
    })),
  });
  render(React.createElement(MappingSuggestions, props()));
  fireEvent.click(screen.getByRole("button", { name: "Suggest mappings" }));
  fireEvent.click(await screen.findByText("Fields without a match (1)"));
  await screen.findByText("No match");
  expect(screen.queryByText("Suggested")).toBeNull();
  expect(screen.getByRole("button", { name: "Apply selected mappings" }).hasAttribute("disabled")).toBe(true);
});

it("discards requests when the parent invalidates the source context", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(rpc).mockReturnValue(
    new Promise(r => {
      resolve = r;
    })
  );
  const p = props();
  const view = render(React.createElement(MappingSuggestions, { ...p, key: "old-context" }));
  fireEvent.click(screen.getByRole("button", { name: "Suggest mappings" }));
  const signal = vi.mocked(rpc).mock.calls[0][1]?.signal;
  view.rerender(React.createElement(MappingSuggestions, { ...p, modelId: "other-model", key: "new-context" }));
  expect(signal?.aborted).toBe(true);
  resolve(response);
  await waitFor(() => expect(screen.queryByText("Review suggested mappings")).toBeNull());
  expect(p.onApply).not.toHaveBeenCalled();
});

it("does not show suggestions from changed model columns", async () => {
  vi.mocked(rpc).mockResolvedValue({ ...response, columns: [{ name: "different", type: "text" }] });
  render(React.createElement(MappingSuggestions, props()));
  fireEvent.click(screen.getByRole("button", { name: "Suggest mappings" }));
  await screen.findByText(/Model columns changed/);
  expect(screen.queryByText("Review suggested mappings")).toBeNull();
});

it("does not request or apply suggestions while disabled", () => {
  render(React.createElement(MappingSuggestions, { ...props(), disabled: true }));
  fireEvent.click(screen.getByRole("button", { name: "Suggest mappings" }));
  expect(rpc).not.toHaveBeenCalled();
});
