import { SetOpts, Store, TTLStore } from "@jitsu/protocols/functions";
import type { Redis } from "ioredis";
import parse from "parse-duration";
import { MongoClient, ReadPreference, Collection, ClientSession } from "mongodb";
import { getLog } from "juava";

export const defaultTTL = 60 * 60 * 24 * 31; // 31 days
export const maxAllowedTTL = 2147483647; // max allowed value for ttl in redis (68years)

export const log = getLog("store");

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

// TODO: deprecate. we cannot control ttl for hash keys. So this store will consume memory indefinitely
export const createOldStore = (namespace: string, redisClient: Redis): Store => ({
  get: async (key: string) => {
    const res = await redisClient.hget(`store:${namespace}`, key);
    return res ? JSON.parse(res) : undefined;
  },
  set: async (key: string, obj: any) => {
    await redisClient.hset(`store:${namespace}`, key, JSON.stringify(obj));
  },
  del: async (key: string) => {
    await redisClient.hdel(`store:${namespace}`, key);
  },
  ttl: async (key: string) => {
    return await redisClient.ttl(`store:${namespace}`);
  },
});

export const createTtlStore = (namespace: string, redisClient: Redis, defaultTtlSec: number): Store => ({
  get: async (key: string) => {
    const res = await redisClient.get(`store:${namespace}:${key}`);
    return res ? JSON.parse(res) : undefined;
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

export const createMongoStore = (namespace: string, mongo: MongoClient, fast: boolean): TTLStore => {
  const localCache: Record<string, StoreValue> = {};
  const readOptions = fast ? { readPreference: ReadPreference.NEAREST } : {};
  const writeOptions = fast ? { writeConcern: { w: 1, journal: false } } : {};

  const dbName = `persistent_store`;

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

  return {
    get: async (key: string) => {
      const res =
        localCache[key] ||
        (await ensureCollection()
          .then(c => c.findOne({ _id: key }, readOptions))
          .catch(e => {
            log.atError().withCause(e).log(`Error getting key ${key} from mongo store ${namespace}`);
          }));
      return res ? res.value : undefined;
    },
    getWithTTL: async (key: string) => {
      const res =
        localCache[key] ||
        (await ensureCollection()
          .then(c => c.findOne({ _id: key }, readOptions))
          .catch(e => {
            log.atError().withCause(e).log(`Error getting key ${key} from mongo store ${namespace}`);
          }));
      if (!res) {
        return undefined;
      }
      const ttl = res.expireAt ? Math.max(Math.floor((res.expireAt.getTime() - new Date().getTime()) / 1000), 0) : -1;
      return { value: res.value, ttl };
    },
    set: async (key: string, obj: any, opts?: SetOpts) => {
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
          localCache[key] = colObj;
        })
        .catch(e => {
          log.atError().withCause(e).log(`Error setting key ${key} from mongo store ${namespace}`);
        });
    },
    del: async (key: string) => {
      await ensureCollection()
        .then(c => c.deleteOne({ _id: key }, writeOptions))
        .then(() => {
          delete localCache[key];
        })
        .catch(e => {
          log.atError().withCause(e).log(`Error deleting key ${key} from mongo store ${namespace}`);
        });
    },
    ttl: async (key: string) => {
      const res =
        localCache[key] ||
        (await ensureCollection()
          .then(c => c.findOne({ _id: key }, readOptions))
          .catch(e => {
            log.atError().withCause(e).log(`Error getting key ${key} from mongo store ${namespace}`);
          }));
      return res
        ? res.expireAt
          ? Math.max(Math.floor((res.expireAt.getTime() - new Date().getTime()) / 1000), 0)
          : -1
        : -2;
    },
  };
};

export const createMultiStore = (newStore: Store, oldStore: Store): Store => {
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
      return await newStore.ttl(key);
    },
  };
};

export const createMemoryStore = (store: any): Store => ({
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
