import { describe, expect, it } from "vitest";
import {
  callerBudgetMs,
  endpointCallerBudgetMs,
  executionDeadline,
  isWorkerEvictable,
} from "../src/lib/worker-pool-utils";

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

// Rotor waits for the whole UDF chain for FUNCTIONS_SERVER_TIMEOUT_MS; the fetch timeout it also sends only limits each fetch
describe("how long an execution keeps its worker from being evicted", () => {
  it("reads the caller's budget from the header, else uses the default", () => {
    expect(callerBudgetMs("60000", 30_000)).toBe(60_000);
    expect(callerBudgetMs(null, 30_000)).toBe(30_000);
    expect(callerBudgetMs(undefined, 30_000)).toBe(30_000);
    expect(callerBudgetMs("", 30_000)).toBe(30_000);
    expect(callerBudgetMs("abc", 30_000)).toBe(30_000);
    expect(callerBudgetMs("-5", 30_000)).toBe(30_000);
    expect(callerBudgetMs("0", 30_000)).toBe(30_000);
  });

  // the header is not part of the request signature, so a value is trusted only up to a sane limit
  it("does not trust a budget longer than ten minutes", () => {
    expect(callerBudgetMs("600000", 30_000)).toBe(600_000);
    expect(callerBudgetMs("999999999999", 30_000)).toBe(600_000);
  });

  it("runs to the end of the caller's budget plus the grace period, not of the fetch timeout", () => {
    expect(executionDeadline({ now: 1000, budgetMs: 60_000, fetchTimeoutMs: 2000, graceMs: 30_000 })).toBe(91_000);
  });

  it("never ends before the fetch timeout, if that is the larger number", () => {
    expect(executionDeadline({ now: 1000, budgetMs: 1000, fetchTimeoutMs: 5000, graceMs: 30_000 })).toBe(36_000);
  });

  // the case in the review: 2 s fetch timeout, 60 s HTTP budget, WORKER_TTL_MS=1000, a scan 35 s into a 40 s chain
  it("does not evict a worker 35 s into a chain that the caller still waits for", () => {
    const start = 100_000;
    const deadline = executionDeadline({ now: start, budgetMs: 60_000, fetchTimeoutMs: 2000, graceMs: 30_000 });
    expect(
      isWorkerEvictable({ now: start + 35_000, lastUsedAt: start, ttlMs: 1000, executionDeadlines: [deadline] })
    ).toBe(false);
  });

  it("evicts it once the caller's budget and the grace period are over", () => {
    const start = 100_000;
    const deadline = executionDeadline({ now: start, budgetMs: 60_000, fetchTimeoutMs: 2000, graceMs: 30_000 });
    expect(
      isWorkerEvictable({ now: start + 91_000, lastUsedAt: start, ttlMs: 1000, executionDeadlines: [deadline] })
    ).toBe(true);
  });
});

// /connection/<id> is called by rotor, which sends its budget (and an older one is covered by the server's default); /multi is
// called by the Go ingest, which waits about 200 ms, sends only a 180 ms fetch timeout and no budget
describe("the budget assumed for a caller that sends none", () => {
  const SERVER_DEFAULT = 30_000;

  it("is the server's FUNCTIONS_SERVER_TIMEOUT_MS for rotor's endpoint", () => {
    expect(endpointCallerBudgetMs("connection", null, SERVER_DEFAULT)).toBe(30_000);
    expect(endpointCallerBudgetMs("connection", "60000", SERVER_DEFAULT)).toBe(60_000);
  });

  it("is none for the Go ingest's /multi, so its executions are held for the fetch timeout and the grace period only", () => {
    const budget = endpointCallerBudgetMs("multi", null, SERVER_DEFAULT);
    expect(budget).toBe(0);
    // the eviction deadline of a hung execution stays at 180 ms + the 30 s grace period, not 60 s
    expect(executionDeadline({ now: 0, budgetMs: budget, fetchTimeoutMs: 180, graceMs: 30_000 })).toBe(30_180);
  });

  it("still believes a budget that /multi sends, up to the same limit", () => {
    expect(endpointCallerBudgetMs("multi", "5000", SERVER_DEFAULT)).toBe(5000);
    expect(endpointCallerBudgetMs("multi", "999999999999", SERVER_DEFAULT)).toBe(600_000);
  });
});
