import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyRuntime, windowRuntime, withCachedViewport } from "../../src/analytics-plugin";

afterEach(() => vi.unstubAllGlobals());

describe("browser screen context", () => {
  it("shares viewport reads across runtimes, refreshing only on resize", () => {
    const browserWindow = Object.assign(new EventTarget(), {
      screen: { width: 1920, height: 1080 },
      devicePixelRatio: 1.5,
      visualViewport: new EventTarget(),
    });
    const width = vi.fn(() => 800);
    const height = vi.fn(() => 600);
    Object.defineProperties(browserWindow, {
      innerWidth: { get: width },
      innerHeight: { get: height },
    });
    const addListener = vi.spyOn(browserWindow, "addEventListener");
    vi.stubGlobal("window", browserWindow);

    const first = windowRuntime({});
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
    const before = first.screen!();
    expect(before).toEqual({ width: 1920, height: 1080, innerWidth: 800, innerHeight: 600, density: 1 });

    width.mockReturnValue(640);
    height.mockReturnValue(480);
    for (let i = 0; i < 20; i++) {
      expect(windowRuntime({}).screen!()).toEqual(before);
    }
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledTimes(1);

    browserWindow.screen = { width: 2560, height: 1440 };
    browserWindow.devicePixelRatio = 2;
    browserWindow.dispatchEvent(new Event("resize"));
    browserWindow.dispatchEvent(new Event("resize"));
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);
    const after = first.screen!();
    expect(after).toEqual({ width: 2560, height: 1440, innerWidth: 640, innerHeight: 480, density: 2 });
    expect(width).toHaveBeenCalledTimes(2);
    expect(height).toHaveBeenCalledTimes(2);
    width.mockReturnValue(320);
    browserWindow.visualViewport.dispatchEvent(new Event("resize"));
    expect(width).toHaveBeenCalledTimes(2);
    expect(first.screen!()!.innerWidth).toBe(320);
    expect(width).toHaveBeenCalledTimes(3);
    expect(before!.innerWidth).toBe(800);
    after!.innerWidth = 123;
    expect(first.screen!()!.innerWidth).toBe(320);
  });

  it.each([{}, { addEventListener: vi.fn(), document: {} }])("can read screen dimensions from a partial DOM", shim => {
    const partial = { screen: { width: 1024, height: 768 }, innerWidth: 800, innerHeight: 600, ...shim };
    vi.stubGlobal("window", partial);
    const runtime = windowRuntime({});
    expect(runtime.screen!()?.innerWidth).toBe(800);
    partial.innerWidth = 640;
    expect(runtime.screen!()?.innerWidth).toBe(640);
  });

  it("does not access window in the server runtime", () => {
    vi.stubGlobal("window", undefined);
    expect(emptyRuntime({}).screen!()).toBeUndefined();
  });
});

describe("withCachedViewport", () => {
  // a window without addEventListener always reads live, which is what we want for exact read counting
  const fakeWindow = (props: PropertyDescriptorMap) => {
    const win = { screen: { width: 1, height: 1 } };
    Object.defineProperties(win, props);
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {});
    return win as any;
  };

  it("serves each property once from a single measurement, then hands the real window back", () => {
    const width = vi.fn(() => 800);
    const height = vi.fn(() => 600);
    const win = fakeWindow({
      innerWidth: { get: width, configurable: true, enumerable: true },
      innerHeight: { get: height, configurable: true, enumerable: true },
    });
    const originals = ["innerWidth", "innerHeight"].map(key => Object.getOwnPropertyDescriptor(win, key));

    const result = withCachedViewport(() => {
      // what analytics.js does inside page(): both reads, back to back
      const seen = [win.innerWidth, win.innerHeight];
      // everything after that (pageStart listeners, plugins) must see the real window again
      width.mockReturnValue(1);
      height.mockReturnValue(2);
      return [...seen, win.innerWidth, win.innerHeight];
    });

    expect(result).toEqual([800, 600, 1, 2]);
    // one measurement to fill the cache, one live read after the cached one was served
    expect(width).toHaveBeenCalledTimes(2);
    expect(height).toHaveBeenCalledTimes(2);
    expect(["innerWidth", "innerHeight"].map(key => Object.getOwnPropertyDescriptor(win, key))).toEqual(originals);
  });

  it("restores properties the callback never read", () => {
    const width = vi.fn(() => 800);
    const height = vi.fn(() => 600);
    const win = fakeWindow({
      innerWidth: { get: width, configurable: true, enumerable: true },
      innerHeight: { get: height, configurable: true, enumerable: true },
    });
    const originals = ["innerWidth", "innerHeight"].map(key => Object.getOwnPropertyDescriptor(win, key));
    withCachedViewport(() => undefined);
    expect(["innerWidth", "innerHeight"].map(key => Object.getOwnPropertyDescriptor(win, key))).toEqual(originals);
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);
  });

  it("restores plain data properties, and removes properties the window did not own", () => {
    const win = fakeWindow({ innerWidth: { value: 800, writable: true, configurable: true, enumerable: true } });
    const proto = { innerHeight: 600 };
    Object.setPrototypeOf(win, proto);
    withCachedViewport(() => {
      expect(win.innerWidth).toBe(800);
      expect(win.innerHeight).toBe(600);
    });
    expect(Object.getOwnPropertyDescriptor(win, "innerWidth")).toEqual({
      value: 800,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    expect(Object.prototype.hasOwnProperty.call(win, "innerHeight")).toBe(false);
    expect(win.innerHeight).toBe(600);
  });

  it("restores the window and rethrows when the callback throws", () => {
    const win = fakeWindow({ innerWidth: { value: 800, writable: true, configurable: true, enumerable: true } });
    expect(() =>
      withCachedViewport(() => {
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(Object.getOwnPropertyDescriptor(win, "innerWidth")?.value).toBe(800);
  });

  it("returns the callback's value, including a promise", async () => {
    fakeWindow({
      innerWidth: { value: 800, configurable: true },
      innerHeight: { value: 600, configurable: true },
    });
    await expect(withCachedViewport(() => Promise.resolve("sent"))).resolves.toBe("sent");
  });

  it("still runs the callback when a property cannot be redefined", () => {
    const win = fakeWindow({
      innerWidth: { value: 800, configurable: true },
      innerHeight: { value: 600, configurable: false },
    });
    const originalWidth = Object.getOwnPropertyDescriptor(win, "innerWidth");
    expect(withCachedViewport(() => win.innerWidth + win.innerHeight)).toBe(1400);
    expect(Object.getOwnPropertyDescriptor(win, "innerWidth")).toEqual(originalWidth);
  });

  it("just runs the callback outside a browser", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    expect(withCachedViewport(() => 42)).toBe(42);
  });
});
