import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamDeadline } from "./stream-deadline";

afterEach(() => vi.useRealTimers());
describe("stream read deadlines", () => {
  it("allows a slow consumer without extending a stalled read's deadline", async () => {
    vi.useFakeTimers();
    const deadline = new StreamDeadline(undefined, 30_000, 120_000);
    try {
      expect(await deadline.read(async () => "page 1")).toBe("page 1");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(deadline.signal.aborted).toBe(false);
      expect(await deadline.read(async () => "page 2")).toBe("page 2");
      const pending = expect(deadline.read(() => new Promise(() => {}))).rejects.toThrow("Warehouse read timed out");
      await vi.advanceTimersByTimeAsync(30_000);
      await pending;
      expect(deadline.signal.aborted).toBe(true);
    } finally {
      deadline.close();
    }
  });
  it("keeps an overall deadline even while the consumer is paused", async () => {
    vi.useFakeTimers();
    const deadline = new StreamDeadline(undefined, 100, 1000);
    try {
      await deadline.read(async () => 1);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(deadline.read(async () => 2)).rejects.toThrow("Warehouse extraction deadline exceeded");
    } finally {
      deadline.close();
    }
  });
  it("aborts an outstanding read on cancellation and clears its timers", async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = new StreamDeadline(parent.signal);
    const pending = expect(deadline.read(() => new Promise(() => {}))).rejects.toThrow("cancelled");
    parent.abort(new Error("cancelled"));
    await pending;
    deadline.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
