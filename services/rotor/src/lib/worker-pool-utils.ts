/**
 * Whether the pool may terminate a workspace's worker. Idleness is measured from the last request that reached the worker, so
 * a worker still running an execution (a slow fetch, with a short WORKER_TTL_MS) would be terminated under it, and the event
 * would wait for a result that never comes. An execution protects its worker only until its deadline, though: a UDF stuck in
 * a synchronous loop never answers, the caller has long given up, and the worker has to be reclaimed after that.
 */
export function isWorkerEvictable(o: {
  now: number;
  lastUsedAt: number;
  ttlMs: number;
  /** for each execution still running in the worker: when the caller's time budget (plus a grace period) runs out */
  executionDeadlines: Iterable<number>;
}): boolean {
  if (o.now - o.lastUsedAt <= o.ttlMs) {
    return false;
  }
  for (const deadline of o.executionDeadlines) {
    if (deadline > o.now) {
      return false;
    }
  }
  return true;
}

// the header is not part of the request signature, so a value longer than this is not believed
const MAX_CALLER_BUDGET_MS = 600_000;

/**
 * The time rotor waits for the whole UDF chain (its FUNCTIONS_SERVER_TIMEOUT_MS), as it sends it in the
 * `x-request-budget-ms` header; the default when it sends none (an older rotor). The `x-request-timeout-ms` header is
 * another number: it limits each outbound fetch.
 */
export function callerBudgetMs(header: string | null | undefined, defaultMs: number): number {
  const n = header ? Number(header) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_CALLER_BUDGET_MS) : defaultMs;
}

/** When an execution stops keeping its worker from being evicted: the caller's budget (or the fetch timeout, if larger) plus a grace period. */
export function executionDeadline(o: {
  now: number;
  budgetMs: number;
  fetchTimeoutMs: number;
  graceMs: number;
}): number {
  return o.now + Math.max(o.budgetMs, o.fetchTimeoutMs) + o.graceMs;
}

/**
 * The caller's budget for one of the two endpoints that run a chain. /connection/<id> is called by rotor, which sends its
 * budget, and the server's own FUNCTIONS_SERVER_TIMEOUT_MS stands in for an older rotor that does not. /multi is called by the
 * Go ingest, which waits for a fraction of a second and sends only a short fetch timeout: assuming rotor's 30 s for it would
 * keep a hung worker for much longer than the ingest waits, so with no header it is assumed to wait for no more than the
 * fetch timeout.
 */
export function endpointCallerBudgetMs(
  endpoint: "connection" | "multi",
  header: string | null | undefined,
  serverDefaultMs: number
): number {
  return callerBudgetMs(header, endpoint === "multi" ? 0 : serverDefaultMs);
}
