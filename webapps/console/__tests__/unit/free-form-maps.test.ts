import { describe, expect, it } from "vitest";
import { deepMerge } from "juava";
import {
  collectJsonSchemaFreeFormPaths,
  getDestinationFreeFormPaths,
  replaceFreeFormMaps,
} from "../../lib/schema/free-form-maps";

// Regression guard for the "can't remove a warehouse `parameters` entry" bug:
// config updates deepMerge the patch into the stored object, which can add and
// overwrite keys but never remove them. Free-form maps have to be replaced.

/** What configObjectType.merge("destination") does, minus the secret masking. */
function mergeDestination(stored: any, patch: any) {
  return replaceFreeFormMaps(deepMerge(stored, patch), patch, getDestinationFreeFormPaths(stored.destinationType));
}

describe("getDestinationFreeFormPaths", () => {
  it("finds `parameters` on the warehouses that declare a catchall", () => {
    for (const type of ["clickhouse", "snowflake", "mysql"]) {
      expect(getDestinationFreeFormPaths(type), type).toContain("parameters");
    }
  });

  it("finds it on mysql, whose `parameters` declares `tls` alongside the catchall", () => {
    // The signal is the catchall, not an empty shape.
    expect(getDestinationFreeFormPaths("mysql")).toEqual(["parameters"]);
  });

  it("returns nothing for destinations with fully declared credentials", () => {
    expect(getDestinationFreeFormPaths("webhook")).toEqual([]);
  });

  it("returns nothing for an unknown destination type", () => {
    expect(getDestinationFreeFormPaths("no-such-destination")).toEqual([]);
  });
});

describe("destination update: credentials.parameters", () => {
  const stored = () => ({
    id: "d1",
    destinationType: "snowflake",
    account: "acct",
    database: "DB",
    password: "secret",
    parameters: { QUERY_TAG: "jitsu", CLIENT_SESSION_KEEP_ALIVE: "true" },
  });

  it("adds a parameter", () => {
    const patch = { parameters: { QUERY_TAG: "jitsu", CLIENT_SESSION_KEEP_ALIVE: "true", TIMEZONE: "UTC" } };
    expect(mergeDestination(stored(), patch).parameters).toEqual({
      QUERY_TAG: "jitsu",
      CLIENT_SESSION_KEEP_ALIVE: "true",
      TIMEZONE: "UTC",
    });
  });

  it("changes a parameter", () => {
    const patch = { parameters: { QUERY_TAG: "changed", CLIENT_SESSION_KEEP_ALIVE: "true" } };
    expect(mergeDestination(stored(), patch).parameters).toEqual({
      QUERY_TAG: "changed",
      CLIENT_SESSION_KEEP_ALIVE: "true",
    });
  });

  it("removes one parameter", () => {
    const patch = { parameters: { QUERY_TAG: "jitsu" } };
    expect(mergeDestination(stored(), patch).parameters).toEqual({ QUERY_TAG: "jitsu" });
  });

  it("removes all parameters", () => {
    const patch = { parameters: {} };
    expect(mergeDestination(stored(), patch).parameters).toEqual({});
  });

  it("leaves other fields merged as before", () => {
    const patch = { parameters: {}, database: "DB2" };
    const result = mergeDestination(stored(), patch);
    expect(result.database).toEqual("DB2");
    expect(result.account).toEqual("acct");
  });

  it("keeps the stored map when the patch doesn't mention it (partial update)", () => {
    // The write-key auto-save / CLI --field / MCP update_resource shape.
    const patch = { database: "DB2" };
    const result = mergeDestination(stored(), patch);
    expect(result.parameters).toEqual({ QUERY_TAG: "jitsu", CLIENT_SESSION_KEEP_ALIVE: "true" });
    expect(result.password).toEqual("secret");
  });
});

describe("collectJsonSchemaFreeFormPaths (service specs)", () => {
  it("finds objects with additionalProperties, nested and in oneOf branches", () => {
    const spec = {
      properties: {
        host: { type: "string" },
        options: { type: "object", additionalProperties: { type: "string" } },
        tunnel: {
          type: "object",
          properties: {
            extra: { type: "object", additionalProperties: true },
            port: { type: "integer" },
          },
        },
        auth: {
          oneOf: [
            { properties: { token: { type: "string" } } },
            { properties: { headers: { type: "object", additionalProperties: { type: "string" } } } },
          ],
        },
      },
    };
    expect(collectJsonSchemaFreeFormPaths(spec).sort()).toEqual([
      "credentials.auth.headers",
      "credentials.options",
      "credentials.tunnel.extra",
    ]);
  });

  it("ignores objects with a closed key set", () => {
    const spec = { properties: { nested: { type: "object", properties: { a: { type: "string" } } } } };
    expect(collectJsonSchemaFreeFormPaths(spec)).toEqual([]);
  });

  it("tolerates a missing or empty spec", () => {
    expect(collectJsonSchemaFreeFormPaths(undefined)).toEqual([]);
    expect(collectJsonSchemaFreeFormPaths({})).toEqual([]);
  });
});
