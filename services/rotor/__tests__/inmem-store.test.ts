import { createInMemoryStore } from "../src/lib/inmem-store";
import { getLog } from "juava";
import * as path from "path";

const log = getLog("inmem-store-test");
test("Test in-mem store", async () => {
  const artifactsDir = path.join(__dirname, "artifacts");
  const cacheDir = path.join(artifactsDir, "in-mem-store");
  const loader = (ifModifiedSince?: Date) => {
    return new Promise<{ store: Date; lastModified: Date }>(resolve =>
      setTimeout(() => resolve({ store: new Date(), lastModified: new Date() }), 300)
    );
  };
  const badLoader = (ifModifiedSince?: Date) => {
    return new Promise<{ store: Date; lastModified: Date }>((resolve, reject) =>
      setTimeout(() => reject(new Error("")), 300)
    );
  };

  const store = createInMemoryStore<Date>({
    name: "test",
    refresh: loader,
    refreshIntervalMillis: 200,
    localDir: cacheDir,
  });

  try {
    expect(store.getCurrent()).toBeUndefined();
    expect(store.status()).toBe("initializing");
    expect(await store.get()).toBeDefined();
    expect(store.status()).toBe("ok");
    expect(store.getCurrent()).toBeDefined();

    const date1 = await store.get();
    log.atInfo().log(`Date1: ${date1.toISOString()}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const date2 = await store.get();
    log.atInfo().log(`Date2: ${date2.toISOString()}`);
    expect(date1.getTime() < date2.getTime()).toBeTruthy();
  } finally {
    store.stop();
  }
  log.atInfo().log("Testing bad store");
  const badStore = createInMemoryStore<Date>({
    name: "test",
    refresh: badLoader,
    refreshIntervalMillis: 200,
    localDir: cacheDir,
  });

  try {
    expect(badStore.getCurrent()).toBeUndefined();
    expect(badStore.status()).toBe("initializing");
    expect(await badStore.get()).toBeDefined();
    expect(badStore.status()).toBe("outdated");
    expect(badStore.getCurrent()).toBeDefined();
  } finally {
    badStore.stop();
  }
}, 10000);
