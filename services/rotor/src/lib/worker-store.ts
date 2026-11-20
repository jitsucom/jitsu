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
