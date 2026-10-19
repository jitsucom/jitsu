// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { reverseStreamEditors } from "../../components/ReverseETL/streams";
import FieldListEditorLayout from "../../components/FieldListEditorLayout/FieldListEditorLayout";
import { ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";

vi.mock("../../components/ReverseETL/DestinationTargetSelector", () => ({
  DestinationTargetSelector: ({ value, onChange }: any) =>
    React.createElement("input", { value, onChange: (e: any) => onChange(e.target.value) }),
}));
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Fields({
  destination,
  options,
  update = () => {},
  disabled = false,
  protocol,
}: {
  destination: string;
  options: ReverseSyncOptions;
  update?: (patch: Partial<ReverseSyncOptions>) => void;
  disabled?: boolean;
  protocol?: string;
}) {
  const stream = reverseStreamEditors[destination].find(s => s.id === options.stream)!;
  return React.createElement(FieldListEditorLayout, {
    items: stream.fields(options, update, disabled, {
      columns: [
        { name: "email", type: "text" },
        { name: "hash", type: "text" },
      ],
      loading: false,
      destinationProtocol: protocol,
    }),
  });
}
function options(destination: string, stream: string, patch: Partial<ReverseSyncOptions> = {}) {
  const defaults = reverseStreamEditors[destination].find(s => s.id === stream)!.defaults();
  return ReverseSyncOptions.parse({ ...defaults, stream, ...patch });
}

it("renders required fields, alternatives with AND/OR instructions, then optional fields", () => {
  render(React.createElement(Fields, { destination: "google-ads", options: options("google-ads", "audience") }));
  const headings = screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent);
  expect(headings).toEqual(["Required fields", "Required alternatives", "Optional and conditional fields"]);
  expect(screen.getByText("Choose at least one option")).toBeTruthy();
  expect(screen.getByText(/Complete address: first name AND last name AND country AND postal code/)).toBeTruthy();
  expect(screen.getByText(/checks mappings or defaults, not the values in every model row/)).toBeTruthy();
  const required = screen.getByText("Customer Match terms");
  const alternatives = screen.getByRole("heading", { name: "Required alternatives" });
  expect(required.compareDocumentPosition(alternatives) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("updates alternative configuration status without requiring all alternatives", () => {
  const initial = options("google-ads", "audience");
  const view = render(React.createElement(Fields, { destination: "google-ads", options: initial }));
  view.rerender(
    React.createElement(Fields, {
      destination: "google-ads",
      options: { ...initial, mapping: { hashedEmail: "hash" } },
    })
  );
  expect(screen.getByText("Configured")).toBeTruthy();
  expect(screen.queryByText("Choose at least one option")).toBeNull();
  expect(screen.getByRole("combobox", { name: "phone column" })).toBeTruthy();
});

it("preserves the identifier control and format when a selector moves it between sections", () => {
  const initial = options("google-ads", "conversion-adjustments", { mapping: { hashedEmail: "hash" } });
  const update = vi.fn();
  const view = render(React.createElement(Fields, { destination: "google-ads", options: initial, update }));
  const email = screen.getByRole("combobox", { name: "email column" });
  const retraction = { ...initial, streamOptions: { ...initial.streamOptions, adjustmentType: "RETRACTION" } };
  view.rerender(React.createElement(Fields, { destination: "google-ads", options: retraction, update }));
  expect(screen.getByRole("combobox", { name: "email column" })).toBe(email);
  expect(screen.getByText("This mapping does not apply to the current selection.")).toBeTruthy();
  expect(within(email.closest(".flex")!).getByText("SHA-256")).toBeTruthy();
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Clear mapping" }));
  expect(update).toHaveBeenCalledWith({ mapping: {} });
  view.rerender(
    React.createElement(Fields, { destination: "google-ads", options: retraction, update, disabled: true })
  );
  expect((screen.getByRole("button", { name: "Clear mapping" }) as HTMLButtonElement).disabled).toBe(true);
});

it("renders row-conditional requirements for mapped adjustment types without marking all fields mandatory", () => {
  const initial = options("google-ads", "conversion-adjustments", { mapping: { adjustmentType: "kind" } });
  render(React.createElement(Fields, { destination: "google-ads", options: initial }));
  expect(screen.getByText("For RESTATEMENT and RETRACTION rows")).toBeTruthy();
  expect(screen.getByText("For ENHANCEMENT rows; original order ID is also required")).toBeTruthy();
  expect(screen.getAllByText("Required for matching rows")).toHaveLength(2);
  expect(screen.getByRole("combobox", { name: "Restated value" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "email column" })).toBeTruthy();
});

it("shows HTTP acknowledgement only for HTTP (or an unknown protocol)", () => {
  const initial = options("webhook", "rows");
  const view = render(React.createElement(Fields, { destination: "webhook", options: initial, protocol: "http:" }));
  expect(screen.getByRole("checkbox", { name: /accept sending data over unencrypted/ })).toBeTruthy();
  view.rerender(React.createElement(Fields, { destination: "webhook", options: initial, protocol: "https:" }));
  expect(screen.queryByRole("checkbox", { name: /accept sending data over unencrypted/ })).toBeNull();
});
