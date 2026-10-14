// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DestinationConnections } from "../../components/DestinationConnections/DestinationConnections";
import type { DestinationConfig } from "../../lib/schema";

const workspace = vi.hoisted(() => ({ slugOrId: "workspace", featuresEnabled: ["reverse-etl"] }));
vi.mock("../../lib/context", () => ({ useWorkspace: () => workspace }));
beforeEach(() => {
  workspace.featuresEnabled = ["reverse-etl"];
});
afterEach(cleanup);
const destination = (destinationType: string) => ({ id: "target", destinationType } as DestinationConfig);
const link = (type: string, extra = {}) => ({ type, toId: "target", ...extra });

it("counts only this destination's non-deleted reverse syncs, including paused ones", () => {
  render(
    React.createElement(DestinationConnections, {
      destination: destination("google-ads"),
      links: [
        link("reverse-sync"),
        link("reverse-sync", { data: { disabled: true } }),
        link("reverse-sync", { deleted: true }),
        link("reverse-sync", { toId: "other" }),
      ],
    })
  );
  expect(screen.getByRole("link", { name: "2 Reverse ETL syncs" }).getAttribute("href")).toBe(
    "/workspace/reverse-syncs?destinationId=target"
  );
  expect(screen.queryByText(/Create/)).toBeNull();
  expect(screen.queryByRole("link", { name: /site/ })).toBeNull();
});

it("shows each populated connection type separately with its own filter", () => {
  render(
    React.createElement(DestinationConnections, {
      destination: destination("google-ads"),
      links: [link("push"), link("push"), link("sync"), link("reverse-sync")],
    })
  );
  expect(screen.getByRole("link", { name: "2 sites" }).getAttribute("href")).toBe(
    "/workspace/connections?destination=target"
  );
  expect(screen.getByRole("link", { name: "1 sync" }).getAttribute("href")).toBe("/workspace/syncs?destination=target");
  expect(screen.getByRole("link", { name: "1 Reverse ETL sync" })).toBeTruthy();
});

it.each(["google-ads", "facebook-conversions", "microsoft-ads", "webhook"])(
  "offers a preselected Reverse ETL sync for %s",
  destinationType => {
    render(React.createElement(DestinationConnections, { destination: destination(destinationType), links: [] }));
    expect(screen.getByRole("link", { name: "Reverse ETL sync" }).getAttribute("href")).toBe(
      "/workspace/reverse-syncs?id=new&destinationId=target"
    );
    expect(screen.queryByRole("link", { name: "sync" })).toBeNull();
    expect(!!screen.queryByRole("link", { name: "site connection" })).toBe(destinationType !== "microsoft-ads");
  }
);

it("keeps warehouse connection and ordinary sync creation without offering unsupported Reverse ETL", () => {
  render(React.createElement(DestinationConnections, { destination: destination("postgres"), links: [] }));
  expect(screen.getByRole("link", { name: "sync" }).getAttribute("href")).toBe(
    "/workspace/syncs/edit?destination=target"
  );
  expect(screen.getByRole("link", { name: "site connection" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Reverse ETL sync" })).toBeNull();
});

it("retains navigation to existing syncs when rollout is disabled, but does not offer creation", () => {
  workspace.featuresEnabled = [];
  const view = render(
    React.createElement(DestinationConnections, {
      destination: destination("microsoft-ads"),
      links: [link("reverse-sync")],
    })
  );
  expect(screen.getByRole("link", { name: "1 Reverse ETL sync" })).toBeTruthy();
  view.rerender(React.createElement(DestinationConnections, { destination: destination("microsoft-ads"), links: [] }));
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(screen.getByText(/Reverse ETL is not enabled/)).toBeTruthy();
});
