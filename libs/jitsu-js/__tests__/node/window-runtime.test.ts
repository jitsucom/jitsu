import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyRuntime, windowRuntime } from "../../src/analytics-plugin";

afterEach(() => vi.unstubAllGlobals());

describe("browser screen context", () => {
  it("shares viewport reads across runtimes, refreshing only on resize", () => {
    const browserWindow = Object.assign(new EventTarget(), {
      screen: { width: 1920, height: 1080 },
      devicePixelRatio: 1.5,
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
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);
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
    const after = first.screen!();
    expect(after).toEqual({ width: 2560, height: 1440, innerWidth: 640, innerHeight: 480, density: 2 });
    expect(width).toHaveBeenCalledTimes(2);
    expect(height).toHaveBeenCalledTimes(2);
    expect(before!.innerWidth).toBe(800);
    after!.innerWidth = 123;
    expect(first.screen!()!.innerWidth).toBe(640);
  });

  it("does not access window in the server runtime", () => {
    vi.stubGlobal("window", undefined);
    expect(emptyRuntime({}).screen!()).toBeUndefined();
  });
});
