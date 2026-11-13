import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@jitsu/core-functions-lib";
import { memoizedPerWorkspace } from "../src/lib/worker-store";

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
