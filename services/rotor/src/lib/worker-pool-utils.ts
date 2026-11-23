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
