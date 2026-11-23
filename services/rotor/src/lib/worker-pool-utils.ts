/**
 * Whether the pool may terminate a workspace's worker: it was idle for longer than `ttlMs`, counted from the last request that
 * reached it.
 */
export function isWorkerEvictable(o: { now: number; lastUsedAt: number; ttlMs: number }): boolean {
  return o.now - o.lastUsedAt > o.ttlMs;
}

/**
 * The idle time a worker gets: the configured WORKER_TTL_MS, but never less than `floorMs`. A request can run for as long as
 * its caller waits for the chain (rotor's FUNCTIONS_SERVER_TIMEOUT_MS, the Go ingest's DEVICE_FUNCTIONS_TIMEOUT_MS), and
 * idleness is counted from when it started, so a shorter time would let the pool terminate a worker under a running execution
 * (the caller then gets an error where the chain would have finished). A worker whose execution never finishes, a UDF stuck in
 * a synchronous loop, is still reclaimed once the floor has passed.
 */
export function effectiveWorkerTtlMs(configuredMs: number, floorMs: number): number {
  return Number.isFinite(configuredMs) ? Math.max(configuredMs, floorMs) : floorMs;
}
