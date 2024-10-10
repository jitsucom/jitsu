import { SetOpts, TTLStore } from "@jitsu/protocols/functions";
import type { Redis } from "ioredis";
import parse from "parse-duration";
import { MongoClient, ReadPreference, Collection } from "mongodb";
import { RetryError } from "@jitsu/functions-lib";

export const defaultTTL = 60 * 60 * 24 * 31; // 31 days
export const maxAllowedTTL = 2147483647; // max allowed value for ttl in redis (68years)

function getTtlSec(opts?: SetOpts): number {
  let seconds = defaultTTL;
  if (typeof opts === "number") {
    seconds = Math.ceil(opts);
  } else if (typeof opts === "string") {
    if (opts.toLowerCase() === "inf") {
      seconds = -1;
    } else {
      try {
        seconds = Math.ceil(parse(opts, "s") || defaultTTL);
      } catch (e) {}
    }
  } else if (typeof opts === "object") {
    return getTtlSec(opts.ttl);
  }
  return Math.min(seconds, maxAllowedTTL);
}

export const createTtlStore = (namespace: string, redisClient: Redis): TTLStore => ({
  get: async (key: string) => {
    const res = await redisClient.get(`store:${namespace}:${key}`);
    return res ? JSON.parse(res) : undefined;
  },
  getWithTTL: async (key: string) => {
    const res = await redisClient.get(`store:${namespace}:${key}`);
    if (!res) {
      return undefined;
    }
    const ttl = await redisClient.ttl(`store:${namespace}:${key}`);
    return { value: JSON.parse(res), ttl };
  },
  set: async (key: string, obj: any, opts?: SetOpts) => {
    const ttl = getTtlSec(opts);
    if (ttl >= 0) {
      await redisClient.set(`store:${namespace}:${key}`, JSON.stringify(obj), "EX", ttl);
    } else {
      await redisClient.set(`store:${namespace}:${key}`, JSON.stringify(obj));
    }
  },
  del: async (key: string) => {
    await redisClient.del(`store:${namespace}:${key}`);
  },
  ttl: async (key: string) => {
    return await redisClient.ttl(`store:${namespace}:${key}`);
  },
});

interface StoreValue {
  _id: string;
  value: any;
  expireAt: Date;
}

const MongoCreatedCollections: Record<string, Collection<StoreValue>> = {};

export const createMongoStore = (
  namespace: string,
  mongo: MongoClient,
  useLocalCache: boolean,
  fast: boolean
): TTLStore => {
  const localCache: Record<string, StoreValue> = {};
  const readOptions = fast ? { readPreference: ReadPreference.NEAREST } : {};
  const writeOptions = fast ? { writeConcern: { w: 1, journal: false } } : {};

  const dbName = `persistent_store`;

  function getFromLocalCache(key: string): StoreValue | undefined {
    if (!useLocalCache) {
      return undefined;
    }
    return localCache[key];
  }

  async function ensureCollection(): Promise<Collection<StoreValue>> {
    let collection = MongoCreatedCollections[namespace];
    if (collection) {
      return collection;
    }
    try {
      const db = mongo.db(dbName);

      const col = db.collection<StoreValue>(namespace);
      const collStatus = await col
        .aggregate([{ $collStats: { count: {} } }])
        .next()
        .catch(e => {});
      if (collStatus) {
        //collection already exists
        MongoCreatedCollections[namespace] = col;
        return col;
      }
      collection = await db.createCollection<StoreValue>(namespace, {
        storageEngine: { wiredTiger: { configString: "block_compressor=zstd" } },
      });
      await collection.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
      MongoCreatedCollections[namespace] = collection;
      return collection;
    } catch (err) {
      throw new Error(`Failed to create collection ${namespace}: ${err}`);
    }
  }

  function storeErr(err: any, text: string) {
    if ((err.message ?? "").includes("timed out")) {
      return new RetryError(text + ". Timed out.");
    }
    return new RetryError(text);
  }

  return {
    get: async (key: string) => {
      try {
        const res =
          getFromLocalCache(key) || (await ensureCollection().then(c => c.findOne({ _id: key }, readOptions)));
        return res ? res.value : undefined;
      } catch (err: any) {
        throw storeErr(err, `Error getting key ${key} from mongo store ${namespace}`);
      }
    },
    getWithTTL: async (key: string) => {
      try {
        const res =
          getFromLocalCache(key) || (await ensureCollection().then(c => c.findOne({ _id: key }, readOptions)));
        if (!res) {
          return undefined;
        }
        const ttl = res.expireAt ? Math.max(Math.floor((res.expireAt.getTime() - new Date().getTime()) / 1000), 0) : -1;
        return { value: res.value, ttl };
      } catch (err: any) {
        throw storeErr(err, `Error getting key ${key} from mongo store ${namespace}`);
      }
    },
    set: async (key: string, obj: any, opts?: SetOpts) => {
      try {
        const colObj: any = { value: obj };
        const ttl = getTtlSec(opts);
        if (ttl >= 0) {
          const expireAt = new Date();
          expireAt.setSeconds(expireAt.getSeconds() + ttl);
          colObj.expireAt = expireAt;
        }

        await ensureCollection()
          .then(c =>
            c.replaceOne({ _id: key }, colObj, {
              upsert: true,
              ...writeOptions,
            })
          )
          .then(() => {
            if (useLocalCache) {
              localCache[key] = colObj;
            }
          });
      } catch (err: any) {
        throw storeErr(err, `Error setting key ${key} in mongo store ${namespace}`);
      }
    },
    del: async (key: string) => {
      try {
        await ensureCollection()
          .then(c => c.deleteOne({ _id: key }, writeOptions))
          .then(() => {
            if (useLocalCache) {
              delete localCache[key];
            }
          });
      } catch (err: any) {
        throw storeErr(err, `Error deleting key ${key} from mongo store ${namespace}`);
      }
    },
    ttl: async (key: string) => {
      try {
        const res =
          getFromLocalCache(key) || (await ensureCollection().then(c => c.findOne({ _id: key }, readOptions)));
        return res
          ? res.expireAt
            ? Math.max(Math.floor((res.expireAt.getTime() - new Date().getTime()) / 1000), 0)
            : -1
          : -2;
      } catch (err: any) {
        throw storeErr(err, `Error getting key ${key} from mongo store ${namespace}`);
      }
    },
  };
};

export const createMultiStore = (newStore: TTLStore, oldStore: TTLStore): TTLStore => {
  return {
    get: async (key: string) => {
      const res = await newStore.get(key);
      if (res) {
        return res;
      }
      return await oldStore.get(key);
    },
    set: async (key: string, obj: any, opts?: SetOpts) => {
      await newStore.set(key, obj, opts);
    },
    del: async (key: string) => {
      await newStore.del(key);
      await oldStore.del(key);
    },
    ttl: async (key: string) => {
      const res = await newStore.ttl(key);
      if (res >= -1) {
        return res;
      }
      return await oldStore.ttl(key);
    },
    getWithTTL: async (key: string) => {
      const res = await newStore.getWithTTL(key);
      if (res) {
        return res;
      }
      return await oldStore.getWithTTL(key);
    },
  };
};

export const createDummyStore = (): TTLStore => ({
  get: async (key: string) => {
    return undefined;
  },
  set: async (key: string, obj: any, opts) => {},
  del: async (key: string) => {},
  ttl: async (key: string) => {
    return -2;
  },
  getWithTTL: async (key: string) => {
    return undefined;
  },
});

export const createMemoryStore = (store: any): TTLStore => ({
  get: async (key: string) => {
    const val = store[key];
    if (val?.expireAt) {
      if (val.expireAt < new Date().getTime()) {
        delete store[key];
        return undefined;
      }
      return val.obj;
    }
    return val;
  },
  set: async (key: string, obj: any, opts) => {
    store[key] = {
      obj,
      expireAt: new Date().getTime() + getTtlSec(opts) * 1000,
    };
  },
  del: async (key: string) => {
    delete store[key];
  },
  ttl: async (key: string) => {
    const val = store[key];
    if (!val) {
      return -2;
    }
    const diff = (val.expireAt - new Date().getTime()) / 1000;
    if (diff < 0) {
      delete store[key];
      return -2;
    }
    return Math.floor(diff);
  },
  getWithTTL: async (key: string) => {
    const val = store[key];
    if (!val) {
      return undefined;
    }
    const diff = (val.expireAt - new Date().getTime()) / 1000;
    if (diff < 0) {
      delete store[key];
      return undefined;
    }
    return {
      value: val.obj,
      ttl: Math.floor(diff),
    };
  },
});

export const memoryStoreDump = (store: any): any => {
  const dt = new Date().getTime();
  return Object.entries(store as Record<string, any>)
    .map(([k, v]) => {
      if (v?.expireAt) {
        if (v.expireAt < dt) {
          return null;
        }
        return [k, v.obj];
      }
      return [k, v];
    })
    .filter(v => v !== null)
    .reduce((prev, cur) => {
      if (cur) {
        prev[cur[0]] = cur[1];
      }
      return prev;
    }, {});
};
