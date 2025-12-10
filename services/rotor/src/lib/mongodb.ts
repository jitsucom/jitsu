import { getLog, getSingleton, parseDate, parseNumber, requireDefined, Singleton } from "juava";
import { MongoClient, Collection, ObjectId, ReadPreference } from "mongodb";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { AnonymousEventsStore, SetOpts, TTLStore } from "@jitsu/protocols/functions";
import { getTtlSec, StoreMetrics } from "@jitsu/core-functions-lib";
import { storeErr } from "./store";
import { getServerEnv } from "../serverEnv";

const AnonymousEventsStoreIdField = "_jitsu_anonymous_id_";

const log = getLog("mongodb");
const serverEnv = getServerEnv();

export const mongodb = getSingleton<MongoClient>("mongodb", createClient, {
  errorTtlSec: 5,
  cleanupFunc: async (client: MongoClient) => {
    await client.close();
  },
  optional: true,
});

async function createClient() {
  const mongoTimeout = parseNumber(serverEnv.MONGODB_TIMEOUT_MS, 1000);
  const mongodbURL = requireDefined(serverEnv.MONGODB_URL, "env MONGODB_URL is not defined");

  log.atInfo().log(`Connecting to MongoDB server...`);

  // Create a new MongoClient
  const client = new MongoClient(mongodbURL, {
    compressors: serverEnv.MONGODB_NETWORK_COMPRESSION ? serverEnv.MONGODB_NETWORK_COMPRESSION : ["zstd"],
    serverSelectionTimeoutMS: 60000,
    maxPoolSize: 32,
    connectTimeoutMS: 60000,
    socketTimeoutMS: mongoTimeout,
  });
  try {
    // Connect the client to the server (optional starting in v4.7)
    await client.connect();
    // Establish and verify connection
    await client.db().admin().ping();
    return client;
  } catch (e) {
    client.close(true);
    throw e;
  }
}

const MongoCreatedCollections: Record<string, Collection<any>> = {};

export function mongoAnonymousEventsStore(): AnonymousEventsStore {
  return {
    async addEvent(collectionName: string, anonymousId: string, event: AnalyticsServerEvent, ttlDays: number) {
      const mongo = mongodb();
      await ensureMongoCollection(mongo, collectionName, ttlDays, [AnonymousEventsStoreIdField]);
      const res = await mongo
        .db()
        .collection(collectionName)
        .insertOne(
          { ...event, timestamp: parseDate(event.timestamp, new Date()), [AnonymousEventsStoreIdField]: anonymousId },
          { writeConcern: { w: 1, journal: false } }
        );
      if (res.acknowledged) {
        return;
      } else {
        throw new Error(`insert operation not acknowledged: ${JSON.stringify(res)}}`);
      }
    },

    async evictEvents(collectionName: string, anonymousId: string) {
      const mongo = mongodb();
      // to ensure query consistency between find and delete query - limit them to the same time window
      const maxObjectId = new ObjectId(Math.floor(new Date().getTime() / 1000).toString(16) + "0000000000000000");
      // load anonymous events from user_recognition collection
      const res = await mongo
        .db()
        .collection(collectionName)
        .find(
          { [AnonymousEventsStoreIdField]: anonymousId, _id: { $lt: maxObjectId } },
          { projection: { _id: 0, [AnonymousEventsStoreIdField]: 0 } }
        )
        .map(e => e as unknown as AnalyticsServerEvent)
        .toArray();
      if (res.length > 0) {
        // delete anonymous events from user_recognition collection
        await mongo
          .db()
          .collection(collectionName)
          .deleteMany({ [AnonymousEventsStoreIdField]: anonymousId, _id: { $lt: maxObjectId } });
        return res;
      }
      return [];
    },
  };
}

async function ensureMongoCollection(
  mongo: MongoClient,
  collectionName: string,
  ttlDays: number,
  indexFields: string[] = []
) {
  if (MongoCreatedCollections.hasOwnProperty(collectionName)) {
    return;
  }
  try {
    const db = mongo.db();
    const col = db.collection(collectionName);
    const collStatus = await col
      .aggregate([{ $collStats: { count: {} } }])
      .next()
      .catch(e => {});
    if (collStatus) {
      //collection already exists
      MongoCreatedCollections[collectionName] = col;
      return;
    }
    const collection = await db.createCollection(collectionName, {
      clusteredIndex: {
        key: { _id: 1 },
        unique: true,
      },
      writeConcern: { w: 1, journal: false },
      storageEngine: { wiredTiger: { configString: "block_compressor=zstd" } },
    });
    await collection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * ttlDays });
    if (indexFields.length > 0) {
      const index = {};
      indexFields.forEach(field => {
        index[field] = 1;
      });
      await collection.createIndex(index);
    }
    MongoCreatedCollections[collectionName] = collection;
  } catch (err) {
    throw new Error(`Failed to create collection ${collectionName}: ${err}`);
  }
}

function success(namespace: string, operation: "get" | "set" | "del" | "ttl", metrics?: StoreMetrics) {
  if (metrics) {
    metrics.storeStatus(namespace, operation, "success");
  }
}

interface StoreValue {
  _id: string;
  value: any;
  expireAt: Date;
}

export const createMongoStore = (
  namespace: string,
  mongo: Singleton<MongoClient>,
  useLocalCache: boolean,
  fast: boolean,
  metrics?: StoreMetrics
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
      const db = mongo().db(dbName);

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
        clusteredIndex: {
          key: { _id: 1 },
          unique: true,
        },
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
      try {
        const res =
          getFromLocalCache(key) || (await ensureCollection().then(c => c.findOne({ _id: key }, readOptions)));
        success(namespace, "get", metrics);
        return res ? res.value : undefined;
      } catch (err: any) {
        throw storeErr(namespace, "get", err, `Error getting key ${key} from mongo store ${namespace}`, metrics);
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
        success(namespace, "get", metrics);
        return { value: res.value, ttl };
      } catch (err: any) {
        throw storeErr(namespace, "get", err, `Error getting key ${key} from mongo store ${namespace}`, metrics);
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
          })
          .then(() => {
            success(namespace, "set", metrics);
          });
      } catch (err: any) {
        throw storeErr(namespace, "set", err, `Error setting key ${key} in mongo store ${namespace}`, metrics);
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
        success(namespace, "del", metrics);
      } catch (err: any) {
        throw storeErr(namespace, "del", err, `Error deleting key ${key} from mongo store ${namespace}`, metrics);
      }
    },
    ttl: async (key: string) => {
      try {
        const res =
          getFromLocalCache(key) || (await ensureCollection().then(c => c.findOne({ _id: key }, readOptions)));
        success(namespace, "ttl", metrics);
        return res
          ? res.expireAt
            ? Math.max(Math.floor((res.expireAt.getTime() - new Date().getTime()) / 1000), 0)
            : -1
          : -2;
      } catch (err: any) {
        throw storeErr(namespace, "ttl", err, `Error getting key ${key} from mongo store ${namespace}`, metrics);
      }
    },
  };
};
