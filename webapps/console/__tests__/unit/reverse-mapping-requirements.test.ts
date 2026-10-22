// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { reverseStreamEditors, streamFieldGroups } from "../../components/ReverseETL/streams";
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
    groups: streamFieldGroups,
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

it("renders separate requirement cards with descriptions, without OR bullet lists", () => {
  render(React.createElement(Fields, { destination: "google-ads", options: options("google-ads", "audience") }));
  const headings = screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent);
  expect(headings).toEqual(["Required fields", "Customer matching", "Optional and conditional fields"]);
  expect(screen.getByText("Choose at least one option")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.getByText(/If any address part is supplied, all four address parts are required/)).toBeTruthy();
  expect(screen.queryByText("Required alternative")).toBeNull();
  expect(screen.queryByText(/checks mappings or defaults, not the values in every model row/)).toBeNull();
  const required = screen.getByText("Customer Match terms");
  const alternatives = screen.getByRole("heading", { name: "Customer matching" });
  expect(required.compareDocumentPosition(alternatives) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("gives every object mapping its own card outside the optional-fields block", () => {
  render(
    React.createElement(Fields, { destination: "google-ads", options: options("google-ads", "click-conversions") })
  );
  const names = screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent);
  expect(names).toContain("Custom variables");
  expect(names).toContain("Session attributes (object)");
  expect(names.indexOf("Custom variables")).toBeLessThan(names.indexOf("Optional and conditional fields"));
  expect(screen.getAllByLabelText("Compose object")).toHaveLength(2);
});

it("places object requirement notes in the card description before its mapping controls", () => {
  render(
    React.createElement(Fields, {
      destination: "facebook-conversions",
      options: options("facebook-conversions", "conversions"),
    })
  );
  const note = screen.getByText("Required for app rows, including tracking flags and all 16 extinfo positions.");
  const heading = screen.getByRole("heading", { name: "App data" });
  const controls = screen.getByLabelText("App data mapping mode");
  expect(heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(note.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it.each(["hover", "focus"])("explains configuration status when the whole tag receives %s", async trigger => {
  render(
    React.createElement(Fields, {
      destination: "google-ads",
      options: options("google-ads", "audience", { mapping: { email: "email" } }),
    })
  );
  const label = screen.getByText("Configured");
  const tag = label.closest(".ant-tag")!;
  expect(tag.getAttribute("tabindex")).toBe("0");
  expect(tag.firstElementChild?.classList.contains("anticon")).toBe(true);
  if (trigger === "hover") fireEvent.mouseEnter(label);
  else fireEvent.focus(tag);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toBe("“Configured” checks mappings or defaults, not the values in every model row.");
});

it("shows concise conversion guidance without a banner, before requirement cards", () => {
  render(
    React.createElement(Fields, { destination: "google-ads", options: options("google-ads", "click-conversions") })
  );
  expect(screen.queryByText("Insert new events only")).toBeNull();
  const hint = screen.getByText(
    "Only new model primary keys are sent; changes to previously sent rows are not resent."
  );
  expect(hint.closest(".ant-alert")).toBeNull();
  expect(
    hint.compareDocumentPosition(screen.getByRole("heading", { name: "Required fields" })) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  for (const streams of Object.values(reverseStreamEditors))
    for (const stream of streams) {
      const items = stream.fields(
        ReverseSyncOptions.parse({ ...stream.defaults(), stream: stream.id }),
        () => {},
        false,
        { columns: [], loading: false }
      );
      const firstCard = items.findIndex(item => item.key?.includes(":section:"));
      expect(firstCard).toBe(stream.id === "rows" ? 0 : 1);
      expect(items.slice(firstCard).some(item => item.rowClassName?.includes("!border-0"))).toBe(false);
    }
});

it.each(["google-ads", "facebook-conversions", "microsoft-ads"])(
  "%s retains a short mirror warning but no existing-audience banner",
  destination => {
    const initial = options(destination, "audience");
    const view = render(React.createElement(Fields, { destination, options: initial }));
    const warning = screen.getByText(
      "Tracked members missing from the model are removed. An empty model clears tracked membership."
    );
    expect(warning.closest(".ant-alert-warning")).toBeTruthy();
    view.rerender(
      React.createElement(Fields, {
        destination,
        options: {
          ...initial,
          mode: "upsert",
          streamOptions: { ...initial.streamOptions, audience: { kind: "existing", audienceId: "123" } },
        },
      })
    );
    expect(screen.queryByText(/An empty model clears/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  }
);

it("keeps Webhook acknowledgments without the delivery banner", () => {
  render(
    React.createElement(Fields, { destination: "webhook", options: options("webhook", "rows"), protocol: "http:" })
  );
  expect(screen.queryByText("Rows are sent as JSON with POST requests")).toBeNull();
  expect(screen.getByRole("checkbox", { name: /tolerates receiving the same record/ })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /accept sending data over unencrypted/ })).toBeTruthy();
});

it("gives every alternative its own card and keeps compound requirements readable", () => {
  const initial = options("google-ads", "conversion-adjustments", { mapping: { adjustmentType: "kind" } });
  render(React.createElement(Fields, { destination: "google-ads", options: initial }));
  expect(screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent)).toEqual([
    "Adjustment type",
    "Required fields",
    "Original conversion",
    "Enhanced matching",
    "Optional and conditional fields",
  ]);
  for (const name of [
    "Required fields",
    "Original conversion",
    "Enhanced matching",
    "Optional and conditional fields",
  ]) {
    expect(screen.getByRole("heading", { name }).closest(".rounded-t-xl")).not.toBeNull();
  }
  expect(screen.getByText("GCLID AND original conversion time must be mapped together.")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
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
  expect(screen.getByText(/Each adjustment needs a new model primary key/).closest(".ant-alert")).toBeNull();
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

it("groups Meta action source first and shows app/messaging fields even for website defaults", () => {
  const initial = options("facebook-conversions", "conversions");
  render(React.createElement(Fields, { destination: "facebook-conversions", options: initial }));
  expect(
    screen
      .getAllByRole("heading", { level: 3 })
      .map(h => h.textContent)
      .slice(0, 3)
  ).toEqual(["Action source", "Event name", "Required fields"]);
  const stream = reverseStreamEditors["facebook-conversions"].find(s => s.id === "conversions")!;
  const items = stream.fields(initial, () => {}, false, { columns: [], loading: false });
  const firstAlternative = items.findIndex(item => item.key?.endsWith(":section:alternative:action-source"));
  const nextAlternative = items.findIndex(item => item.key?.endsWith(":section:alternative:event"));
  expect(items.slice(firstAlternative + 1, nextAlternative).map(item => item.name)).toEqual([
    "Default action source",
    "Action source",
  ]);
  expect(screen.getByRole("combobox", { name: "App data" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Messaging channel" })).toBeTruthy();
  expect(screen.getByText("Default messaging channel")).toBeTruthy();
});

it.each([
  ["website", undefined, ["Event source URL", "Client user agent"]],
  ["app", undefined, ["App data"]],
  ["business_messaging", "messenger", ["Facebook Page ID", "Page-scoped user ID"]],
  ["business_messaging", "whatsapp", ["WhatsApp Business Account ID", "Click-to-WhatsApp ID"]],
  ["business_messaging", "instagram", ["Instagram business account ID", "Instagram-scoped user ID"]],
] as const)("moves %s / %s dependencies into Required fields on selection", (actionSource, messagingChannel, names) => {
  const initial = options("facebook-conversions", "conversions");
  const view = render(React.createElement(Fields, { destination: "facebook-conversions", options: initial }));
  view.rerender(
    React.createElement(Fields, {
      destination: "facebook-conversions",
      options: { ...initial, streamOptions: { ...initial.streamOptions, actionSource, messagingChannel } },
    })
  );
  const headings = screen.getAllByRole("heading", { level: 3 });
  expect(headings[0].textContent).toBe("Action source");
  if (messagingChannel) expect(headings[1].textContent).toBe("Messaging channel");
  const required = screen.getByRole("heading", { name: actionSource === "app" ? "App data" : "Required fields" });
  const next = headings[headings.indexOf(required) + 1];
  for (const name of names) {
    const control = screen.getByRole("combobox", { name });
    expect(required.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(control.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});

it("puts Google adjustment selectors first and promotes restated value when RESTATEMENT is selected", () => {
  const initial = options("google-ads", "conversion-adjustments");
  const view = render(React.createElement(Fields, { destination: "google-ads", options: initial }));
  view.rerender(
    React.createElement(Fields, {
      destination: "google-ads",
      options: { ...initial, streamOptions: { ...initial.streamOptions, adjustmentType: "RESTATEMENT" } },
    })
  );
  const headings = screen.getAllByRole("heading", { level: 3 });
  expect(headings.slice(0, 3).map(h => h.textContent)).toEqual([
    "Adjustment type",
    "Required fields",
    "Original conversion",
  ]);
  const type = screen.getByRole("combobox", { name: "Adjustment type column" });
  const value = screen.getByRole("combobox", { name: "Restated value" });
  expect(type.compareDocumentPosition(headings[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(headings[1].compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(value.compareDocumentPosition(headings[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
