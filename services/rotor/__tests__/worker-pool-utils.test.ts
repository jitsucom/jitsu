import { describe, expect, it } from "vitest";
import { isWorkerEvictable } from "../src/lib/worker-pool-utils";

describe("evicting a worker of the pool", () => {
  const base = { now: 10_000, lastUsedAt: 0, ttlMs: 1000 };

  it("evicts an idle worker once its time is up", () => {
    expect(isWorkerEvictable({ ...base, pendingExecutions: 0 })).toBe(true);
  });

  it("keeps a worker that was used within its time", () => {
    expect(isWorkerEvictable({ ...base, lastUsedAt: 9500, pendingExecutions: 0 })).toBe(false);
  });

  it("keeps a worker that still runs an execution, however long ago the request started", () => {
    expect(isWorkerEvictable({ ...base, pendingExecutions: 1 })).toBe(false);
    expect(isWorkerEvictable({ ...base, pendingExecutions: 5 })).toBe(false);
  });
});
