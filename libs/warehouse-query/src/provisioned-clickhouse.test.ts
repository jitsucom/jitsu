import { expect, it } from "vitest";
import { supportsWarehouseReader } from "./schema";
import { clickHouseHttpConfig } from "./clickhouse";
import { createWarehouseReader } from "./index";

it("supports masked provisioned ClickHouse configs in the model picker", () => {
  expect(supportsWarehouseReader({ destinationType: "clickhouse", provisioned: true })).toBe(true);
  expect(supportsWarehouseReader({ destinationType: "postgres", provisioned: true })).toBe(false);
  expect(supportsWarehouseReader({ destinationType: "clickhouse", protocol: "clickhouse-secure" })).toBe(false);
});
it.each([undefined, "clickhouse", "clickhouse-secure"])(
  "maps provisioned %s endpoints without changing stored credentials",
  async protocol => {
    const config = {
      destinationType: "clickhouse",
      provisioned: true,
      protocol,
      hosts: ["warehouse.test:9440"],
      database: "tenant",
      username: "tenant",
      password: "secret",
    };
    expect(clickHouseHttpConfig(config)).toEqual({ ...config, protocol: "https", hosts: ["warehouse.test:8443"] });
    expect(config.hosts).toEqual(["warehouse.test:9440"]);
    const reader = createWarehouseReader(config);
    await reader.close();
  }
);
it("preserves explicitly configured HTTP endpoints and IPv6 hosts", () => {
  const config = { provisioned: true, protocol: "http", hosts: ["localhost:1234"] };
  expect(clickHouseHttpConfig(config)).toBe(config);
  expect(clickHouseHttpConfig({ provisioned: true, hosts: ["[::1]:9440"] }).hosts).toEqual(["[::1]:8443"]);
});
it.each(["user:password@host", "host/path", "host?readonly=0", "host#fragment"])(
  "rejects endpoint overrides: %s",
  host => {
    expect(() => clickHouseHttpConfig({ provisioned: true, hosts: [host] })).toThrow();
  }
);
