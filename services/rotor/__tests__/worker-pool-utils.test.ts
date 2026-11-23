import { describe, expect, it } from "vitest";
import { effectiveWorkerTtlMs, isWorkerEvictable } from "../src/lib/worker-pool-utils";

describe("evicting a worker of the pool", () => {
  const base = { now: 10_000, lastUsedAt: 0, ttlMs: 1000 };

  it("evicts a worker that was idle for longer than its time", () => {
    expect(isWorkerEvictable(base)).toBe(true);
  });

  it("keeps a worker that was used within its time", () => {
    expect(isWorkerEvictable({ ...base, lastUsedAt: 9500 })).toBe(false);
  });
});

// Idleness is measured from the last request that reached the worker, and a request can run for as long as its caller waits
// for the chain (rotor's FUNCTIONS_SERVER_TIMEOUT_MS, the Go ingest's DEVICE_FUNCTIONS_TIMEOUT_MS, ...). A time shorter than
// that would let the pool terminate a worker under a running execution, so the time has a floor.
describe("the idle time of a worker", () => {
  const FLOOR = 600_000;

  it("is the configured one when it is longer than the floor", () => {
    expect(effectiveWorkerTtlMs(900_000, FLOOR)).toBe(900_000);
    expect(effectiveWorkerTtlMs(FLOOR, FLOOR)).toBe(FLOOR);
  });

  it("is raised to the floor when the configured one is shorter", () => {
    expect(effectiveWorkerTtlMs(1000, FLOOR)).toBe(FLOOR);
    expect(effectiveWorkerTtlMs(0, FLOOR)).toBe(FLOOR);
    expect(effectiveWorkerTtlMs(NaN, FLOOR)).toBe(FLOOR);
  });

  // the cases of the reviews: a short WORKER_TTL_MS and a chain the caller still waits for
  it("keeps a worker under a chain the caller waits 198 s for, whatever WORKER_TTL_MS says", () => {
    const start = 100_000;
    const ttlMs = effectiveWorkerTtlMs(1000, FLOOR);
    expect(isWorkerEvictable({ now: start + 195_000, lastUsedAt: start, ttlMs })).toBe(false);
    expect(isWorkerEvictable({ now: start + 35_000, lastUsedAt: start, ttlMs })).toBe(false);
  });

  it("still reclaims a worker whose execution never finished, once the floor has passed", () => {
    const start = 100_000;
    const ttlMs = effectiveWorkerTtlMs(1000, FLOOR);
    expect(isWorkerEvictable({ now: start + FLOOR + 1, lastUsedAt: start, ttlMs })).toBe(true);
  });
});
