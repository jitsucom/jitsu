// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ObjectMapping } from "../../components/ReverseETL/ObjectMapping";
import type { ReverseEditorOptions } from "@jitsu/protocols/reverse-etl-editor";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import { applyMappingSuggestions, mappingTargets } from "../../lib/reverse-mapping-suggestions";

beforeEach(() =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} }))
  )
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Editor({ disabled = false, fixed = false }: { disabled?: boolean; fixed?: boolean }) {
  const [options, update] = useState<ReverseEditorOptions>({
    mode: "upsert",
    mapping: { customVariables: "json", email: "email" },
    streamOptions: {},
  });
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(ObjectMapping, {
      field: {
        editor: "mapping",
        field: "customVariables",
        name: "Custom variables",
        object: fixed
          ? { properties: [{ key: "value", name: "Value", required: true }] }
          : { additionalProperties: true },
      },
      options,
      update: patch => update(o => ({ ...o, ...patch })),
      disabled,
      showValidation: true,
      selector: (label, value, change) =>
        React.createElement("input", {
          "aria-label": label,
          value: value ?? "",
          disabled,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => change(e.target.value),
        }),
    }),
    React.createElement("output", { "data-testid": "settings" }, JSON.stringify(options))
  );
}
const settings = () => JSON.parse(screen.getByTestId("settings").textContent!);
it("switches mutually exclusive modes, adds/removes properties and preserves unrelated mappings", () => {
  render(React.createElement(Editor));
  expect(screen.getByLabelText("Custom variables").getAttribute("value")).toBe("json");
  fireEvent.change(screen.getByLabelText("Custom variables"), { target: { value: "other_json" } });
  expect(settings().mapping.customVariables).toBe("other_json");
  expect((screen.getByLabelText("Model column") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByLabelText("Compose object"));
  expect(settings().mapping).toEqual({ email: "email" });
  fireEvent.change(screen.getByLabelText("Custom variables new property name"), { target: { value: "tier" } });
  fireEvent.change(screen.getByLabelText("Custom variables new property column"), { target: { value: "level" } });
  fireEvent.click(screen.getByText("Add property"));
  expect(settings().objectMappings).toEqual({ customVariables: { tier: "level" } });
  fireEvent.click(screen.getByText("Remove"));
  expect(settings().objectMappings).toEqual({ customVariables: {} });
  fireEvent.click(screen.getByLabelText("Model column"));
  expect(settings()).not.toHaveProperty("objectMappings");
  expect(settings().mapping).toEqual({ email: "email" });
});
it("shows required properties in composition mode and respects disabled controls", () => {
  const view = render(React.createElement(Editor, { fixed: true }));
  fireEvent.click(screen.getByLabelText("Compose object"));
  expect(screen.getByText("Map this required property.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Custom variables: Value"), { target: { value: "amount" } });
  expect(screen.queryByText("Map this required property.")).toBeNull();
  view.rerender(React.createElement(Editor, { fixed: true, disabled: true }));
  expect((screen.getByLabelText("Model column") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Custom variables: Value") as HTMLInputElement).disabled).toBe(true);
});
it("does not suggest or apply whole-column mappings over a selected composition mode", () => {
  const stream = reverseDestinationMetadata.get("google-ads")!.streams.find(s => s.id === "click-conversions")!;
  const options = { ...stream.defaults(), objectMappings: { customVariables: {} } };
  expect(mappingTargets(stream, options).some(t => t.id === "mapping:customVariables")).toBe(false);
  expect(
    applyMappingSuggestions(
      stream,
      options,
      [{ name: "json", type: "JSON" }],
      [{ key: "customVariables", column: "json", probability: 1 }]
    )
  ).toEqual({});
});
