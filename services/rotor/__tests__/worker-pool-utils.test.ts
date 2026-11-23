import { describe, expect, it } from "vitest";
import { isWorkerEvictable } from "../src/lib/worker-pool-utils";

describe("evicting a worker of the pool", () => {
  const base = { now: 10_000, lastUsedAt: 0, ttlMs: 1000 };

  it("evicts an idle worker once its time is up", () => {
    expect(isWorkerEvictable({ ...base, executionDeadlines: [] })).toBe(true);
  });

  it("keeps a worker that was used within its time", () => {
    expect(isWorkerEvictable({ ...base, lastUsedAt: 9500, executionDeadlines: [] })).toBe(false);
  });

  it("keeps a worker that still runs an execution inside its deadline, however long ago the request started", () => {
    expect(isWorkerEvictable({ ...base, executionDeadlines: [10_500] })).toBe(false);
    expect(isWorkerEvictable({ ...base, executionDeadlines: [20_000, 5_000] })).toBe(false);
  });

  // a UDF stuck in a synchronous loop never answers; the caller has long given up, and the worker must not live forever
  it("evicts a worker whose executions are all past their deadline", () => {
    expect(isWorkerEvictable({ ...base, executionDeadlines: [9_000] })).toBe(true);
    expect(isWorkerEvictable({ ...base, executionDeadlines: [10_000, 1_000] })).toBe(true);
  });
});
