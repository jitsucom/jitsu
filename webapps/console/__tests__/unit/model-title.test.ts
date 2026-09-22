// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ModelIcon, ModelTitle } from "../../components/ReverseETL/ModelTitle";

const state = vi.hoisted(() => ({ type: "postgres", warehouseId: "warehouse" }));
vi.mock("../../lib/store", () => ({
  useConfigObjectList: (type: string) =>
    type === "model"
      ? [{ id: "model", name: "Customers", warehouseId: state.warehouseId }]
      : [{ id: "warehouse", name: "Source", destinationType: state.type }],
}));
vi.mock("../../components/DestinationsCatalog/DestinationsCatalog", () => ({
  getDestinationIcon: (destination: { id: string }) => React.createElement("svg", { "aria-label": destination.id }),
}));
beforeEach(() => {
  state.type = "postgres";
  state.warehouseId = "warehouse";
});
afterEach(cleanup);

it.each(["postgres", "clickhouse"])("uses the model's %s warehouse icon, not a generic model icon", type => {
  state.type = type;
  render(React.createElement(ModelTitle, { modelId: "model", size: "small" }));
  expect(screen.getByText("Customers")).toBeTruthy();
  expect(screen.getByLabelText(type)).toBeTruthy();
  expect(screen.getByRole("img", { name: "SQL model" })).toBeTruthy();
});
it.each(["small", "default", "large"] as const)("keeps a non-wrapping code marker in %s titles", size => {
  render(React.createElement(ModelTitle, { modelId: "model", size }));
  const marker = screen.getByRole("img", { name: "SQL model" });
  expect(marker.tagName.toLowerCase()).toBe("svg");
  expect(marker.getAttribute("viewBox")).toBe("0 0 18 12");
  expect(marker.parentElement?.classList.contains("block")).toBe(true);
  expect(marker.parentElement?.classList.contains("inline-flex")).toBe(false);
});
it("uses the same warehouse icon in ConfigEditor model rows", () => {
  render(React.createElement(ModelIcon, { model: { warehouseId: "warehouse" } }));
  expect(screen.getByLabelText("postgres")).toBeTruthy();
});
it("retains the model title with a fallback icon when the warehouse is missing", () => {
  state.warehouseId = "deleted";
  const { container } = render(React.createElement(ModelTitle, { modelId: "model" }));
  expect(screen.getByText("Customers")).toBeTruthy();
  expect(container.querySelector(".lucide-database")).toBeTruthy();
  expect(screen.getByRole("img", { name: "SQL model" })).toBeTruthy();
});
