import { describe, expect, test, vi } from "vitest";

// config-objects.ts transitively imports the custom-domains server machinery
// (and through it half the app, incl. packages vite can't resolve in the unit
// project). None of it participates in schema generation — stub the boundary.
vi.mock("../../lib/server/custom-domains", () => ({
  checkDomain: vi.fn(),
  checkOrAddToIngress: vi.fn(),
  isDomainAvailable: vi.fn(),
}));
vi.mock("../../pages/api/[workspaceId]/domain-check", () => ({
  getWildcardDomains: vi.fn(() => []),
}));
import { getResourceJsonSchema } from "../../lib/schema/json-schema";
import { ApiError } from "../../lib/shared/errors";

// The public, unauthenticated /api/schema/[...type] route (and the MCP
// get_resource_schema tool) feed arbitrary input here. Unknown types used to
// escape as bare assertion errors -> HTTP 500; they must be a clean 404
// (crawlers resolving JSON-escaped hrefs against the route hit this daily).
describe("getResourceJsonSchema unknown types", () => {
  function expect404(fn: () => unknown) {
    let err: unknown;
    try {
      fn();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  }

  test("known types still resolve", () => {
    expect(getResourceJsonSchema("destination", "postgres")).toHaveProperty("$schema");
    expect(getResourceJsonSchema("destination")).toHaveProperty("$schema");
    expect(getResourceJsonSchema("link", "sync")).toHaveProperty("$schema");
    expect(getResourceJsonSchema("link", "clickhouse")).toHaveProperty("$schema");
  });

  test("unknown destination subtype is 404", () => {
    // the literal shape crawlers produce from JSON-escaped hrefs
    expect404(() => getResourceJsonSchema("destination", '\\"https:/help.mixpanel.com/hc\\"'));
  });

  test("unknown top-level resource type is 404", () => {
    expect404(() => getResourceJsonSchema("no-such-type"));
  });

  test("unknown link subtype is 404", () => {
    expect404(() => getResourceJsonSchema("link", "no-such-destination"));
  });

  test("prototype-inherited names are 404, not a lookup hit", () => {
    // plain-object registries inherit Object.prototype; a truthiness check
    // would resolve these to functions and crash downstream with a 500
    for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect404(() => getResourceJsonSchema(name));
      expect404(() => getResourceJsonSchema("destination", name));
      expect404(() => getResourceJsonSchema("link", name));
    }
  });
});
