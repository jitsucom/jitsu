import { describe, expect, it } from "vitest";
import { getResourceJsonSchema } from "../../lib/schema/json-schema";

// The MCP `get_resource_schema` tool and the public `/api/schema/[...type]` route both
// call getResourceJsonSchema, so this guards the shape both surfaces depend on.
describe("getResourceJsonSchema", () => {
  it("returns {} for an empty type", () => {
    expect(getResourceJsonSchema("")).toEqual({});
  });

  it("returns a JSON schema with properties for each base config type", () => {
    for (const type of ["destination", "stream", "function", "service", "domain", "notification"]) {
      const schema = getResourceJsonSchema(type);
      expect(schema, type).toBeTypeOf("object");
      // base ConfigEntityBase fields are present on every config object
      expect(JSON.stringify(schema), type).toContain("workspaceId");
    }
  });

  it("narrows a destination by subtype", () => {
    const schema = getResourceJsonSchema("destination", "postgres");
    expect(JSON.stringify(schema)).toContain("destinationType");
  });

  it("describes a connection (link) with fromId/toId", () => {
    const schema = getResourceJsonSchema("link");
    const json = JSON.stringify(schema);
    expect(json).toContain("fromId");
    expect(json).toContain("toId");
  });

  it("treats 'connection' subtype 'sync' the same as link/sync", () => {
    // The MCP tool maps "connection" → "link" before calling, so verify link/sync directly.
    const sync = getResourceJsonSchema("link", "sync");
    expect(JSON.stringify(sync)).toContain("data");
  });
});
