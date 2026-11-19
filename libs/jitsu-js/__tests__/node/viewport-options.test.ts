import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRuntime } from "../../src/analytics-plugin";
import { jitsuAnalytics } from "../../src";

// What index.ts does with the viewport cache, observed from the window: page() shadows window.innerWidth while
// analytics.js builds the page data, and start-up schedules one measurement.
describe("which options switch the viewport cache off", () => {
  let shadowed: number;
  let scheduled: number;
  let win: any;

  const options = {
    host: "http://jitsu.test",
    writeKey: "key:secret",
    fetch: vi.fn(async () => new Response("{}")),
    privacy: { dontSend: true },
  };

  beforeEach(() => {
    shadowed = 0;
    scheduled = 0;
    win = {
      innerWidth: 800,
      innerHeight: 600,
      screen: { width: 1, height: 1 },
      location: { hostname: "jitsu.test", href: "http://jitsu.test/", protocol: "http:", search: "" },
      requestAnimationFrame: () => 1,
      setTimeout: () => ++scheduled,
      clearTimeout: () => {},
    };
    win.top = win;
    const define = Object.defineProperty;
    vi.spyOn(Object, "defineProperty").mockImplementation((target: any, key: any, descriptor: any) => {
      if (target === win && key === "innerWidth") shadowed++;
      return define(target, key, descriptor);
    });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { cookie: "", referrer: "", title: "", location: win.location });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("serves page() from the cache and warms it by default", async () => {
    const client = jitsuAnalytics(options);
    await client.page();
    expect(scheduled).toBe(1);
    expect(shadowed).toBeGreaterThan(0);
  });

  it("does neither with disableViewportCache", async () => {
    const client = jitsuAnalytics({ ...options, disableViewportCache: true });
    await client.page();
    expect(scheduled).toBe(0);
    expect(shadowed).toBe(0);
  });

  it("does not serve page() from the window cache when the application supplies its own runtime", async () => {
    // the custom runtime supplies context.screen, so page.properties.width/height must not come from the window cache
    const client = jitsuAnalytics({ ...options, runtime: emptyRuntime({}) });
    await client.page();
    expect(scheduled).toBe(0);
    expect(shadowed).toBe(0);
  });

  it("still starts when warming the cache throws", () => {
    // a window whose `top` throws, as a sandboxed or detached one can
    Object.defineProperty(win, "top", {
      get() {
        throw new Error("blocked");
      },
    });
    expect(() => jitsuAnalytics(options)).not.toThrow();
  });
});
