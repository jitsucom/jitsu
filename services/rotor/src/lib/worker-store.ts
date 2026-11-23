import type { TTLStore } from "@jitsu/protocols/functions";

/**
 * Wraps a store factory so that it creates one store per workspace and hands the same one out afterwards.
 *
 * It is for the in-memory fallback (no MONGODB_URL): the pool of workspace workers calls its store factory every time it
 * spawns a worker, also after an idle worker was evicted, and a new empty in-memory store each time would silently drop
 * everything a function had put in `ctx.store`. A function run in process keeps its store for as long as the server runs.
 */
export function memoizedPerWorkspace(create: (workspaceId: string) => TTLStore): (workspaceId: string) => TTLStore {
  const stores = new Map<string, TTLStore>();
  return (workspaceId: string) => {
    let store = stores.get(workspaceId);
    if (!store) {
      store = create(workspaceId);
      stores.set(workspaceId, store);
    }
    return store;
  };
}

/**
 * The in-memory store of a paid connection, one per workspace and connection, as a function run in process has one when
 * there is no MongoDB. (With MongoDB both paths share the store of the workspace.)
 */
export function memoizedPerConnection(
  create: (workspaceId: string, connectionId: string) => TTLStore
): (workspaceId: string, connectionId: string) => TTLStore {
  const stores = new Map<string, TTLStore>();
  return (workspaceId, connectionId) => {
    const key = `${workspaceId}\u0000${connectionId}`;
    let store = stores.get(key);
    if (!store) {
      store = create(workspaceId, connectionId);
      stores.set(key, store);
    }
    return store;
  };
}

/**
 * The store a worker's `store.*` call goes to. With MongoDB, and for the free class (which has always had one store per
 * workspace), that is the workspace store. Otherwise a paid connection gets its own in-memory store, named by the
 * connection id the worker sent, when that is one of the connections it was started with.
 */
export function storeForProxyCall(o: {
  mongo: boolean;
  freeClass: boolean;
  workspaceStore: TTLStore;
  connectionStore: (workspaceId: string, connectionId: string) => TTLStore;
  workspaceId: string;
  connectionId: unknown;
  /** the connections this worker was started with */
  connectionIds: ReadonlySet<string>;
}): TTLStore {
  // the id comes from sandboxed tenant code: only a connection the worker was started with gets a store of its own,
  // so a made-up id cannot allocate stores (and their sweep timers) without limit
  if (o.mongo || o.freeClass || typeof o.connectionId !== "string" || !o.connectionIds.has(o.connectionId)) {
    return o.workspaceStore;
  }
  return o.connectionStore(o.workspaceId, o.connectionId);
}

/**
 * An in-memory store that also removes expired entries by itself. `createMemoryStore` removes one only when its key is read
 * again, and a store that is kept for as long as the server runs would hold every key that was written once (a
 * deduplication key per event id).
 */
export function createSweptMemoryStore(create: (backing: any) => TTLStore, intervalMs: number = 60_000): TTLStore {
  const backing: Record<string, any> = {};
  const store = create(backing);
  const timer: any = setInterval(() => {
    const now = Date.now();
    for (const key of Object.keys(backing)) {
      const expireAt = backing[key]?.expireAt;
      if (typeof expireAt === "number" && expireAt < now) {
        delete backing[key];
      }
    }
  }, intervalMs);
  // do not keep a process alive for the sweep (Node), nor a Deno server's shutdown
  timer?.unref?.();
  (globalThis as any).Deno?.unrefTimer?.(timer);
  return store;
}
