/**
 * Flat key-value store, Redis-shaped. One global namespace; callers separate
 * concerns with key prefixes (`oauth:code:abc`, `mcp:event:stream-1:...`).
 *
 * Design notes:
 *   - No "table" abstraction. Prefix conventions are simpler and let callers
 *     mix flat keys with prefix scans freely.
 *   - Single-key ops are atomic by virtue of running as one SQL statement.
 *     `getDel` and `ifNotExists` are first-class so callers don't have to
 *     synthesize them out of non-atomic primitives.
 *   - Values are JSON. Pick a stable encodable type — Date → ISO string is
 *     fine, but custom classes need toJSON/serialization.
 */

/**
 * Schedule work to run after the current response is sent (or immediately in
 * non-request contexts). Pass `fn => after(() => fn())` when running inside a
 * Next.js Route Handler; the default is a plain detached promise, safe
 * everywhere but without the "after response" guarantee.
 */
export type FireAndForget = (fn: () => Promise<unknown>) => void;

/** Default: detached promise. Works in any context. */
export const detachedPromise: FireAndForget = fn => void fn().catch(() => undefined);

export type SetOpts = {
  /** Time-to-live in milliseconds. Omit (or 0) for no expiration. */
  ttlMs?: number;
  /**
   * Only store if the key doesn't already exist (or only an expired row
   * exists). Atomic. The return value of `set` tells you whether the write
   * happened. The primitive for distributed-lock-style flows.
   */
  ifNotExists?: boolean;
};

export interface KvStore {
  /** Read a key. Returns undefined if absent or expired. */
  get<T = unknown>(key: string): Promise<T | undefined>;

  /**
   * Write a key. Returns true iff the value was actually written; this is
   * always true unless `ifNotExists` was set and the key was present.
   */
  set(key: string, value: unknown, opts?: SetOpts): Promise<boolean>;

  /** Remove a key. Returns true iff a key was present. */
  del(key: string): Promise<boolean>;

  /**
   * Atomic get-and-delete. Returns the value (or undefined) and removes the
   * key in one statement. This is the keystone primitive for one-shot
   * credentials — OAuth authorization codes, password reset tokens,
   * single-use links — where get-then-delete races would let two callers
   * consume the same token.
   */
  getDel<T = unknown>(key: string): Promise<T | undefined>;

  /**
   * Lexicographic scan of keys with the given prefix. Returns matches
   * sorted ascending by key. Useful when keys carry their own ordering
   * (e.g., time-sortable IDs in an event log).
   *
   * Implementations MAY enforce a hard cap on result size; callers should
   * pass an explicit `limit` when the prefix could match a lot of keys.
   */
  scanByPrefix<T = unknown>(prefix: string, opts?: { limit?: number }): Promise<Array<{ key: string; value: T }>>;
}
