import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@jitsu/core-functions-lib";
import { vi, afterEach } from "vitest";
import {
  createSweptMemoryStore,
  memoizedPerConnection,
  memoizedPerWorkspace,
  storeForProxyCall,
} from "../src/lib/worker-store";

// Without MONGODB_URL a workspace's ctx.store lives in memory. A paid function that runs in an isolated worker used to
// get a new empty store whenever its worker was spawned again after an idle eviction, which silently emptied it; a
// function run in process keeps its store as long as the server runs.
describe("the in-memory store of a workspace outlives its worker", () => {
  it("hands out the same store for a workspace every time, so a respawned worker sees what the evicted one stored", async () => {
    const storeFor = memoizedPerWorkspace(() => createMemoryStore({}));
    await storeFor("workspace1").set("key", { value: 1 }, { ttlSec: 600 });
    // the worker is evicted and spawned again: the pool calls the factory again
    expect(await storeFor("workspace1").get("key")).toEqual({ value: 1 });
  });

  it("keeps workspaces apart", async () => {
    const storeFor = memoizedPerWorkspace(() => createMemoryStore({}));
    await storeFor("workspace1").set("key", "one", { ttlSec: 600 });
    expect(await storeFor("workspace2").get("key")).toBeUndefined();
  });

  it("creates one store per workspace", () => {
    let created = 0;
    const storeFor = memoizedPerWorkspace(() => {
      created++;
      return createMemoryStore({});
    });
    storeFor("workspace1");
    storeFor("workspace1");
    storeFor("workspace2");
    expect(created).toBe(2);
  });
});

// A paid function run in process has a store per connection when there is no MongoDB; a worker used to hand every
// connection of the workspace the same one, so two connections using the same key overwrote each other's values.
describe("the in-memory store of a paid connection", () => {
  const mk = () => {
    const workspaceStore = createMemoryStore({});
    const connectionStore = memoizedPerConnection(() => createMemoryStore({}));
    const pick = (over: Partial<Parameters<typeof storeForProxyCall>[0]> = {}) =>
      storeForProxyCall({
        mongo: false,
        freeClass: false,
        workspaceStore,
        connectionStore,
        workspaceId: "ws1",
        connectionId: "con1",
        connectionIds: new Set(["con1", "con2"]),
        ...over,
      });
    return { workspaceStore, connectionStore, pick };
  };

  it("is separate for each connection, and the same for one connection every time", async () => {
    const { pick } = mk();
    await pick({ connectionId: "con1" }).set("cache-key", "from-con1");
    expect(await pick({ connectionId: "con2" }).get("cache-key")).toBeUndefined();
    expect(await pick({ connectionId: "con1" }).get("cache-key")).toBe("from-con1");
  });

  it("is separate for the same connection id in another workspace", async () => {
    const { pick } = mk();
    const factory = memoizedPerConnection(() => createMemoryStore({}));
    await factory("ws1", "con1").set("k", 1);
    expect(await factory("ws2", "con1").get("k")).toBeUndefined();
    expect(await pick({ workspaceId: "ws1" }).get("k")).toBeUndefined();
  });

  it("stays the workspace store with MongoDB, where in-process also shares one per workspace", () => {
    const { workspaceStore, pick } = mk();
    expect(pick({ mongo: true })).toBe(workspaceStore);
  });

  it("stays the workspace store for the free class, which always had one", () => {
    const { workspaceStore, pick } = mk();
    expect(pick({ freeClass: true })).toBe(workspaceStore);
  });

  // The id comes from the worker, which is tenant code in a sandbox and can send any string
  it("allocates nothing for an id that is not one of the worker's connections", () => {
    const workspaceStore = createMemoryStore({});
    const created: string[] = [];
    const connectionStore = memoizedPerConnection((ws, con) => {
      created.push(`${ws}/${con}`);
      return createMemoryStore({});
    });
    const pick = (connectionId: unknown) =>
      storeForProxyCall({
        mongo: false,
        freeClass: false,
        workspaceStore,
        connectionStore,
        workspaceId: "ws1",
        connectionId,
        connectionIds: new Set(["con1"]),
      });
    expect(pick("con1")).not.toBe(workspaceStore);
    expect(pick("made-up-1")).toBe(workspaceStore);
    expect(pick("made-up-2")).toBe(workspaceStore);
    expect(pick("__proto__")).toBe(workspaceStore);
    expect(created).toEqual(["ws1/con1"]);
  });

  it("stays the workspace store when the worker names no connection", () => {
    const { workspaceStore, pick } = mk();
    expect(pick({ connectionId: undefined })).toBe(workspaceStore);
    expect(pick({ connectionId: "" })).toBe(workspaceStore);
    expect(pick({ connectionId: 42 })).toBe(workspaceStore);
  });
});

// createMemoryStore removes an expired entry only when its key is read again, and the store of a workspace now lives as
// long as the server, so keys that are written once (a deduplication key per event id) would pile up.
describe("the in-memory store drops expired entries by itself", () => {
  afterEach(() => vi.useRealTimers());

  it("removes entries whose time has passed without any key being read, and keeps the others", async () => {
    vi.useFakeTimers();
    let backing: Record<string, any> = {};
    const store = createSweptMemoryStore(b => {
      backing = b;
      return createMemoryStore(b);
    }, 60_000);
    await store.set("short", "a", { ttl: 10 });
    await store.set("long", "b", { ttl: 3600 });
    expect(Object.keys(backing).sort()).toEqual(["long", "short"]);
    // nothing reads a key from here on: only the sweep can remove the expired one
    vi.advanceTimersByTime(30_000);
    expect(Object.keys(backing).sort()).toEqual(["long", "short"]); // expired, but the sweep has not run yet
    vi.advanceTimersByTime(60_000);
    expect(Object.keys(backing)).toEqual(["long"]);
    expect(await store.get("long")).toBe("b");
  });
});
