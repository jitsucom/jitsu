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
  expect(p.onApply).toHaveBeenCalledWith({ mapping: { email: "email" } });
});

it("reviews and applies declared properties without overwriting the rest of the composed object", async () => {
  const conversions = reverseDestinationMetadata
    .get("facebook-conversions")!
    .streams.find(s => s.id === "conversions")!;
  const source = [
    { name: "advertising_enabled", type: "integer" },
    { name: "app_enabled", type: "integer" },
  ];
  const properties = [
    { key: "advertiser_tracking_enabled", label: "Advertiser tracking enabled", column: source[0].name },
    { key: "application_tracking_enabled", label: "Application tracking enabled", column: source[1].name },
  ];
  vi.mocked(rpc).mockResolvedValue({
    columns: source,
    suggestions: properties.map(p => {
      const candidate = { key: "appData", property: p.key, column: p.column, probability: 0.98 };
      return {
        id: `object:${JSON.stringify(["appData", p.key])}`,
        label: `App data / ${p.label}`,
        confidence: 0.95,
        noMatch: false,
        recommended: candidate,
        alternatives: [candidate],
      };
    }),
  });
  const p = {
    ...props(),
    stream: conversions,
    options: { ...conversions.defaults(), objectMappings: { appData: { extinfo: "existing_array" } } },
    columns: source,
  };
  render(React.createElement(MappingSuggestions, p));
  fireEvent.click(screen.getByRole("button", { name: "Suggest mappings" }));
  await screen.findByText("App data / Advertiser tracking enabled");
  expect(screen.getByText("App data / Application tracking enabled")).toBeTruthy();
  expect(p.onApply).not.toHaveBeenCalled();
  expect(vi.mocked(rpc).mock.calls[0][1]?.body).toMatchObject({ objectMappings: p.options.objectMappings });
  fireEvent.click(screen.getByRole("button", { name: "Apply selected mappings" }));
  expect(p.onApply).toHaveBeenCalledWith({
    mapping: {},
    objectMappings: {
      appData: {
        extinfo: "existing_array",
        advertiser_tracking_enabled: "advertising_enabled",
        application_tracking_enabled: "app_enabled",
      },
    },
  });
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
