/**
 * Whether the pool may terminate a workspace's worker. Idleness is measured from the last request that reached the worker, so
 * a worker still running an execution (a slow fetch, with a short WORKER_TTL_MS) would be terminated under it, and the event
 * would wait for a result that never comes. A worker with an execution in flight is not evicted.
 */
export function isWorkerEvictable(o: {
  now: number;
  lastUsedAt: number;
  ttlMs: number;
  pendingExecutions: number;
}): boolean {
  return o.pendingExecutions === 0 && o.now - o.lastUsedAt > o.ttlMs;
}
