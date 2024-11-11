import { z } from "zod";
import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { getSingleton, parseNumber } from "juava";
import { MongoClient } from "mongodb";
import { createHash } from "crypto";
import { mongodb } from "./lib/mongodb";

export const profileIdHashColumn = "_profile_id_hash";
export const profileIdColumn = "_profile_id";
export const idHash32MaxValue = 2147483647;

export const ProfilesConfig = z.object({
  mongoUrl: z.string().optional(),
  enableAnonymousProfiles: z.boolean().optional().default(false),
  profileWindowDays: z.number().optional().default(365),
  runPeriodSec: z.number().optional().default(60),
  eventsDatabase: z.string().optional().default("profiles"),
  eventsCollectionName: z.string().optional().default("profiles-raw"),
  traitsCollectionName: z.string().optional().default("profiles-traits"),
});

const MongoCreatedCollections = new Set<string>();
export type ProfilesConfig = z.infer<typeof ProfilesConfig>;

export const createClient = async (config: ProfilesConfig) => {
  const mongoTimeout = parseNumber(process.env.MONGODB_TIMEOUT_MS, 1000);
  let uri = config.mongoUrl!;

  // Create a new MongoClient
  const client = new MongoClient(uri, {
    compressors: process.env.MONGODB_NETWORK_COMPRESSION ? process.env.MONGODB_NETWORK_COMPRESSION : ["zstd"],
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
};

export function hash(algorithm: string, value: string) {
  return createHash(algorithm).update(value).digest("hex");
}

export function int32Hash(value) {
  // Hash the value using SHA-256 (or another algorithm if desired)
  const h = hash("sha256", value);

  // Convert the first 8 characters of the hash (or more) to an integer
  return parseInt(h.substring(0, 8), 16) % idHash32MaxValue;
}

export const ProfilesFunction: JitsuFunction<AnalyticsServerEvent, ProfilesConfig> = async (event, ctx) => {
  const config = ProfilesConfig.parse(ctx.props || {});

  const userId = event.userId;
  if (!userId) {
    ctx.log.debug(`No userId found. Skipping`);
    return;
  }

  try {
    const mongoSingleton = config.mongoUrl
      ? getSingleton(
          `profiles-mongodb-${ctx.connection?.id}-${hash("md5", config.mongoUrl)}`,
          () => {
            ctx.log.info(`Connecting to MongoDB server.`);
            const cl = createClient(config);
            ctx.log.info(`Connected successfully to MongoDB server.`);
            return cl;
          },
          {
            optional: true,
            ttlSec: 60 * 60 * 24,
            cleanupFunc: client => client.close(),
          }
        )
      : mongodb;
    const mongo = await mongoSingleton.waitInit();
    await pbEnsureMongoCollection(mongo, config.eventsDatabase, config.eventsCollectionName, config.profileWindowDays, [
      profileIdHashColumn,
      profileIdColumn,
      "type",
    ]);
    await pbEnsureMongoCollection(
      mongo,
      config.eventsDatabase,
      config.traitsCollectionName,
      config.profileWindowDays,
      [profileIdColumn],
      true
    );

    if (event.type === "identify") {
      const d = new Date();
      const traits = await mongo
        .db(config.eventsDatabase)
        .collection(config.traitsCollectionName)
        .findOneAndUpdate(
          { [profileIdColumn]: userId },
          [
            {
              $set: {
                [profileIdColumn]: userId,
                userId: {
                  $ifNull: ["$userId", userId],
                },
                anonymousId: {
                  $ifNull: ["$anonymousId", event.anonymousId],
                },
                traits: {
                  $mergeObjects: ["$traits", event.traits],
                },
                createdAt: {
                  $ifNull: ["$createdAt", d],
                },
                updatedAt: d,
              },
            },
          ],
          {
            upsert: true,
            returnDocument: "after",
          }
        );
      ctx.log.info(`Merged profile: ${JSON.stringify(traits)}`);
    }

    const res = await mongo
      .db(config.eventsDatabase)
      .collection(config.eventsCollectionName)
      .insertOne(
        { [profileIdHashColumn]: int32Hash(userId), [profileIdColumn]: userId, ...event },
        { writeConcern: { w: 1, journal: false } }
      );
    if (!res.acknowledged) {
      ctx.log.error(`Failed to insert to MongoDB: ${JSON.stringify(res)}`);
    } else {
      ctx.log.debug(`Inserted to MongoDB: ${JSON.stringify(res)}`);
    }
  } catch (e: any) {
    throw new Error(`Error while sending event to MongoDB: ${e}`);
  }
};

export async function pbEnsureMongoCollection(
  mongo: MongoClient,
  databaseName: string,
  collectionName: string,
  ttlDays: number,
  indexFields: string[] = [],
  unique?: boolean
) {
  if (MongoCreatedCollections.has(collectionName)) {
    return;
  }
  try {
    const db = mongo.db(databaseName);
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
      if (unique) {
        await collection.createIndex(index, { unique: true });
      } else {
        await collection.createIndex(index);
      }
    }
    MongoCreatedCollections.add(collectionName);
  } catch (err) {
    throw new Error(`Failed to create collection ${collectionName}: ${err}`);
  }
}
