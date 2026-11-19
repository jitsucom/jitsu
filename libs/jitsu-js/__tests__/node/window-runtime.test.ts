import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyRuntime, warmViewportCache, windowRuntime, withCachedViewport } from "../../src/analytics-plugin";

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
    // a real EventTarget is called through EventTarget.prototype, which a named element cannot shadow
    const addListener = vi.spyOn(EventTarget.prototype, "addEventListener");
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
    expect(addListener.mock.contexts.filter(context => context === browserWindow)).toHaveLength(1);

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

  it("reads live on every call and registers nothing with disableViewportCache", () => {
    const browserWindow = Object.assign(new EventTarget(), {
      screen: { width: 1920, height: 1080 },
      devicePixelRatio: 1,
      visualViewport: new EventTarget(),
    });
    const width = vi.fn(() => 800);
    Object.defineProperties(browserWindow, {
      innerWidth: { get: width },
      innerHeight: { get: () => 600 },
    });
    // an earlier test leaves this same spy installed, with its calls still counted
    const addListener = vi.spyOn(EventTarget.prototype, "addEventListener").mockClear();
    vi.stubGlobal("window", browserWindow);

    const runtime = windowRuntime({ disableViewportCache: true });
    expect(runtime.screen!()!.innerWidth).toBe(800);
    width.mockReturnValue(640);
    expect(runtime.screen!()!.innerWidth).toBe(640);
    expect(width).toHaveBeenCalledTimes(2);
    expect(addListener).not.toHaveBeenCalled();
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

  it("runs the callback untouched when the live read throws, so its own error handling applies", () => {
    // analytics.js turns an error in page() into a rejected promise, which a caller of page().catch() relies on
    const win = fakeWindow({
      innerWidth: {
        get() {
          throw new Error("getter boom");
        },
        configurable: true,
        enumerable: true,
      },
      innerHeight: { value: 600, configurable: true, enumerable: true },
    });
    const original = Object.getOwnPropertyDescriptor(win, "innerWidth");
    expect(withCachedViewport(() => "ran")).toBe("ran");
    expect(Object.getOwnPropertyDescriptor(win, "innerWidth")).toEqual(original);
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

describe("warmViewportCache", () => {
  // a window whose timers and animation frames only run when the test says so
  const timedWindow = (extra: object = {}) => {
    const frames: (() => void)[] = [];
    const timers = new Map<number, { cb: () => void; ms: number }>();
    let nextTimer = 1;
    const reads = vi.fn(() => 800);
    const win: any = {
      screen: { width: 1, height: 1 },
      innerHeight: 600,
      requestAnimationFrame: (cb: () => void) => frames.push(cb),
      setTimeout: (cb: () => void, ms: number) => {
        timers.set(nextTimer, { cb, ms });
        return nextTimer++;
      },
      clearTimeout: (id: number) => timers.delete(id),
      ...extra,
    };
    Object.defineProperty(win, "innerWidth", { get: reads, configurable: true });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {});
    const runTimers = () => {
      const due = [...timers.entries()];
      timers.clear();
      due.forEach(([, t]) => t.cb());
    };
    const runFrames = () => frames.splice(0).forEach(cb => cb());
    // quiet period -> rendered frame -> the task after it
    const settle = () => {
      runTimers();
      runFrames();
      runTimers();
    };
    return { win, frames, timers, reads, runTimers, runFrames, settle };
  };

  it("measures once, after the quiet period and a rendered frame, not when called", () => {
    const { timers, frames, reads, runTimers, runFrames } = timedWindow();
    warmViewportCache();
    expect(reads).not.toHaveBeenCalled();
    expect([...timers.values()].map(t => t.ms)).toEqual([100]);
    runTimers();
    expect(frames).toHaveLength(1);
    expect(reads).not.toHaveBeenCalled();
    runFrames();
    expect(reads).not.toHaveBeenCalled();
    runTimers();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("restarts the wait on every call, so a burst is measured once", () => {
    const { timers, reads, settle } = timedWindow();
    warmViewportCache();
    warmViewportCache();
    warmViewportCache();
    expect(timers.size).toBe(1);
    settle();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("raises no error from its own timer when the window throws on read", () => {
    // a send hits the same error itself, in the caller's own code. The SDK's housekeeping must not add one.
    const { reads, settle } = timedWindow();
    reads.mockImplementation(() => {
      throw new Error("getter boom");
    });
    warmViewportCache();
    expect(() => settle()).not.toThrow();
    expect(reads).toHaveBeenCalled();
  });

  it("drops a measurement that a newer invalidation has overtaken", () => {
    const { reads, runTimers, runFrames, settle } = timedWindow();
    warmViewportCache();
    runTimers();
    runFrames();
    // the viewport changes again after the quiet period but before the measurement runs
    warmViewportCache();
    runTimers();
    expect(reads).not.toHaveBeenCalled();
    settle();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("does nothing without the timing APIs, or in a hidden document", () => {
    for (const missing of ["requestAnimationFrame", "setTimeout", "clearTimeout"]) {
      const { reads, settle } = timedWindow({ [missing]: undefined });
      warmViewportCache();
      expect(() => settle()).not.toThrow();
      expect(reads).not.toHaveBeenCalled();
    }
    const { reads, win, settle } = timedWindow();
    win.document = { hidden: true };
    warmViewportCache();
    settle();
    expect(reads).not.toHaveBeenCalled();
  });

  it("does nothing inside an iframe, where the viewport is always read live", () => {
    const { timers, reads, settle } = timedWindow({ top: {} });
    warmViewportCache();
    expect(timers.size).toBe(0);
    settle();
    expect(reads).not.toHaveBeenCalled();
  });

  it("still schedules a measurement when the window is its own top", () => {
    const { win, timers } = timedWindow();
    win.top = win;
    warmViewportCache();
    expect(timers.size).toBe(1);
  });

  it("is not fooled by a page script that replaced window.parent in a frame", () => {
    // `var parent = null` in a frame's own script: window.top still differs from the window
    const { timers } = timedWindow({ parent: null, top: {} });
    warmViewportCache();
    expect(timers.size).toBe(0);
  });

  it("is not fooled by a page script that replaced window.parent on a top-level page", () => {
    // `var parent = element` on a top-level page: window.top is still the window itself
    const { win, timers } = timedWindow({ parent: { not: "a window" } });
    win.top = win;
    warmViewportCache();
    expect(timers.size).toBe(1);
  });

  it("does nothing outside a browser", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    expect(() => warmViewportCache()).not.toThrow();
  });
});

describe("viewport signature", () => {
  it("re-reads when a free reading moves, even though no event arrived, and not otherwise", () => {
    const width = vi.fn(() => 400);
    const height = vi.fn(() => 600);
    const browserWindow: any = Object.assign(new EventTarget(), {
      screen: { width: 1, height: 1, orientation: { type: "portrait-primary", angle: 0 } },
      devicePixelRatio: 1,
      outerWidth: 400,
      outerHeight: 600,
      visualViewport: new EventTarget(),
    });
    Object.defineProperties(browserWindow, { innerWidth: { get: width }, innerHeight: { get: height } });
    vi.stubGlobal("window", browserWindow);
    const runtime = windowRuntime({});

    expect(runtime.screen!().innerWidth).toBe(400);
    runtime.screen!();
    runtime.screen!();
    expect(width).toHaveBeenCalledTimes(1);

    // the window is resized: no event has reached the SDK yet, but outerWidth already shows it
    browserWindow.outerWidth = 600;
    width.mockReturnValue(600);
    expect(runtime.screen!().innerWidth).toBe(600);
    expect(width).toHaveBeenCalledTimes(2);
    runtime.screen!();
    expect(width).toHaveBeenCalledTimes(2);

    // each of the other free readings is enough on its own
    browserWindow.screen.orientation.angle = 90;
    runtime.screen!();
    expect(width).toHaveBeenCalledTimes(3);
    browserWindow.devicePixelRatio = 2;
    runtime.screen!();
    expect(width).toHaveBeenCalledTimes(4);
    browserWindow.outerHeight = 400;
    runtime.screen!();
    expect(width).toHaveBeenCalledTimes(5);
    runtime.screen!();
    expect(width).toHaveBeenCalledTimes(5);
  });
});

describe("zone.js originals", () => {
  // Angular runs change detection after every callback registered inside its zone. zone.js keeps the unpatched
  // functions under __zone_symbol__ names, and the SDK's housekeeping should be registered through those.
  const zonedWindow = () => {
    const saved = { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), requestAnimationFrame: vi.fn() };
    const plain = { setTimeout: vi.fn(() => 2), clearTimeout: vi.fn(), requestAnimationFrame: vi.fn() };
    const win: any = {
      screen: { width: 1, height: 1 },
      devicePixelRatio: 1,
      innerHeight: 600,
      setTimeout: plain.setTimeout,
      clearTimeout: plain.clearTimeout,
      requestAnimationFrame: plain.requestAnimationFrame,
      __zone_symbol__setTimeout: saved.setTimeout,
      __zone_symbol__clearTimeout: saved.clearTimeout,
      __zone_symbol__requestAnimationFrame: saved.requestAnimationFrame,
    };
    Object.defineProperty(win, "innerWidth", { get: () => 800, configurable: true });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {});
    return { win, saved, plain };
  };

  it("schedules the quiet-period measurement through the saved timers", () => {
    const { saved, plain } = zonedWindow();
    warmViewportCache();
    warmViewportCache();
    // the second call restarts the wait: it stops the first timer and starts another
    expect(saved.setTimeout).toHaveBeenCalledTimes(2);
    expect(saved.clearTimeout).toHaveBeenCalledTimes(1);
    // the quiet period ends: the SDK asks for a frame, and then for the task after it
    const quietPeriodEnded = saved.setTimeout.mock.calls[1][0] as () => void;
    quietPeriodEnded();
    expect(saved.requestAnimationFrame).toHaveBeenCalledTimes(1);
    const frameRendered = saved.requestAnimationFrame.mock.calls[0][0] as () => void;
    frameRendered();
    expect(saved.setTimeout).toHaveBeenCalledTimes(3);
    expect(plain.setTimeout).not.toHaveBeenCalled();
    expect(plain.clearTimeout).not.toHaveBeenCalled();
    expect(plain.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("registers its resize listeners through the saved addEventListener", () => {
    const visualViewport: any = { addEventListener: vi.fn(), __zone_symbol__addEventListener: vi.fn() };
    const plainAdd = vi.fn();
    const savedAdd = vi.fn();
    const win: any = {
      screen: { width: 1, height: 1 },
      devicePixelRatio: 1,
      innerHeight: 600,
      visualViewport,
      addEventListener: plainAdd,
      __zone_symbol__addEventListener: savedAdd,
    };
    Object.defineProperty(win, "innerWidth", { get: () => 800, configurable: true });
    vi.stubGlobal("window", win);
    windowRuntime({}).screen!();
    expect(savedAdd).toHaveBeenCalledWith("resize", expect.any(Function), true);
    expect(visualViewport.__zone_symbol__addEventListener).toHaveBeenCalledWith("resize", expect.any(Function), true);
    expect(plainAdd).not.toHaveBeenCalled();
    expect(visualViewport.addEventListener).not.toHaveBeenCalled();
  });

  it("finds the saved functions under a custom prefix, which an app sets with __Zone_symbol_prefix", () => {
    const saved = { setTimeout: vi.fn(() => 1), addEventListener: vi.fn() };
    const plain = { setTimeout: vi.fn(() => 2), addEventListener: vi.fn() };
    const win: any = {
      __Zone_symbol_prefix: "__app_",
      screen: { width: 1, height: 1 },
      devicePixelRatio: 1,
      innerHeight: 600,
      requestAnimationFrame: vi.fn(),
      __app_requestAnimationFrame: vi.fn(),
      clearTimeout: vi.fn(),
      __app_clearTimeout: vi.fn(),
      setTimeout: plain.setTimeout,
      __app_setTimeout: saved.setTimeout,
      addEventListener: plain.addEventListener,
      __app_addEventListener: saved.addEventListener,
    };
    Object.defineProperty(win, "innerWidth", { get: () => 800, configurable: true });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {});
    warmViewportCache();
    windowRuntime({}).screen!();
    expect(saved.setTimeout).toHaveBeenCalledTimes(1);
    expect(saved.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function), true);
    expect(plain.setTimeout).not.toHaveBeenCalled();
    expect(plain.addEventListener).not.toHaveBeenCalled();
  });

  it("uses the plain functions when zone.js is not there", () => {
    const { win, saved, plain } = zonedWindow();
    for (const name of ["setTimeout", "clearTimeout", "requestAnimationFrame"]) delete win[`__zone_symbol__${name}`];
    warmViewportCache();
    warmViewportCache();
    expect(plain.setTimeout).toHaveBeenCalledTimes(2);
    expect(plain.clearTimeout).toHaveBeenCalledTimes(1);
    expect(saved.setTimeout).not.toHaveBeenCalled();
  });
});

describe("the cache can never stop an event", () => {
  afterEach(() => vi.restoreAllMocks());

  it("falls back to a live read when registering a listener throws", () => {
    const width = vi.fn(() => 800);
    const browserWindow: any = Object.assign(new EventTarget(), {
      screen: { width: 1, height: 1 },
      devicePixelRatio: 1,
      innerHeight: 600,
      visualViewport: new EventTarget(),
    });
    Object.defineProperty(browserWindow, "innerWidth", { get: width });
    vi.stubGlobal("window", browserWindow);
    vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(() => {
      throw new Error("a page that makes registering impossible");
    });
    const runtime = windowRuntime({});
    expect(runtime.screen!()).toMatchObject({ innerWidth: 800, innerHeight: 600 });
    // nothing was cached, so every send reads the real size
    width.mockReturnValue(640);
    expect(runtime.screen!().innerWidth).toBe(640);
  });

  it("calls a real EventTarget through its prototype, so a shadowed method on the instance cannot break it", () => {
    const width = vi.fn(() => 800);
    // what a named element does to document: the instance's own method is no longer a function
    const visualViewport: any = Object.assign(new EventTarget(), { addEventListener: "shadowed" });
    const browserWindow: any = Object.assign(new EventTarget(), {
      screen: { width: 1, height: 1 },
      devicePixelRatio: 1,
      innerHeight: 600,
      visualViewport,
    });
    Object.defineProperty(browserWindow, "innerWidth", { get: width });
    vi.stubGlobal("window", browserWindow);
    const registered = vi.spyOn(EventTarget.prototype, "addEventListener");
    const runtime = windowRuntime({});
    runtime.screen!();
    runtime.screen!();
    expect(registered.mock.contexts).toContain(visualViewport);
    // the cache was set up despite the shadowed method, so the second send did not read the size again
    expect(width).toHaveBeenCalledTimes(1);
  });
});
