import { describe, expect, it } from "vitest";
import * as api from "../../src";

describe("public API of the package entry", () => {
  it("still exports what it exported before the viewport cache", () => {
    for (const name of [
      "default",
      "jitsuAnalytics",
      "emptyAnalytics",
      "parseQuery",
      "windowRuntime",
      "createInMemoryStorage",
      "emptyRuntime",
      "isInBrowser",
      "ensureAnonymousId",
      "jitsuAnalyticsPlugin",
      "randomId",
      "uuid",
    ]) {
      expect(api, name).toHaveProperty(name);
    }
  });

  it("does not publish the internal viewport helpers", () => {
    // once published, removing an export is a breaking change, so internals stay out of the public API
    expect(Object.keys(api)).not.toContain("withCachedViewport");
    expect(Object.keys(api)).not.toContain("warmViewportCache");
  });
});
