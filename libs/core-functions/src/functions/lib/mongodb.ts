import { getLog, getSingleton, index, parseNumber, requireDefined } from "juava";
import { MongoClient, ObjectId } from "mongodb";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { AnonymousEventsStore } from "@jitsu/protocols/functions";

const AnonymousEventsStoreIdField = "_jitsu_anonymous_id_";

const log = getLog("mongodb");

export const mongodb = getSingleton<MongoClient>("mongodb", createClient, {
  errorTtlSec: 5,
  cleanupFunc: async (client: MongoClient) => {
    await client.close();
  },
});

async function createClient() {
  const mongoTimeout = parseNumber(process.env.MONGODB_TIMEOUT_MS, 1000);
  const mongodbURL = requireDefined(process.env.MONGODB_URL, "env MONGODB_URL is not defined");

  log.atInfo().log(`Connecting to MongoDB server...`);

  // Create a new MongoClient
  const client = new MongoClient(mongodbURL, {
    compressors: ["zstd"],
    serverSelectionTimeoutMS: 60000,
    maxPoolSize: 32,
    connectTimeoutMS: 60000,
    socketTimeoutMS: mongoTimeout,
  });
  // Connect the client to the server (optional starting in v4.7)
  await client.connect();
  // Establish and verify connection
  await client.db().command({ ping: 1 });
  return client;
}

const MongoCreatedCollections = new Set<string>();

export function mongoAnonymousEventsStore(): AnonymousEventsStore {
  return {
    async addEvent(collectionName: string, anonymousId: string, event: AnalyticsServerEvent, ttlDays: number) {
      const mongo = mongodb();
      await ensureMongoCollection(mongo, collectionName, ttlDays, [AnonymousEventsStoreIdField]);
      const res = await mongo
        .db()
        .collection(collectionName)
        .insertOne(
          { ...event, [AnonymousEventsStoreIdField]: anonymousId },
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
  if (MongoCreatedCollections.has(collectionName)) {
    return;
  }
  try {
    const db = mongo.db();
    const collStatus = await db
      .collection(collectionName)
      .aggregate([{ $collStats: { count: {} } }])
      .next()
      .catch(e => {});
    if (collStatus) {
      //collection already exists
      MongoCreatedCollections.add(collectionName);
      return;
    }
    const collection = await db.createCollection(collectionName, {
      expireAfterSeconds: 60 * 60 * 24 * ttlDays,
      clusteredIndex: {
        key: { _id: 1 },
        unique: true,
      },
      writeConcern: { w: 1, journal: false },
      storageEngine: { wiredTiger: { configString: "block_compressor=zstd" } },
    });
    if (indexFields.length > 0) {
      const index = {};
      indexFields.forEach(field => {
        index[field] = 1;
      });
      await collection.createIndex(index);
    }
    MongoCreatedCollections.add(collectionName);
  } catch (err) {
    throw new Error(`Failed to create collection ${collectionName}: ${err}`);
  }
}
