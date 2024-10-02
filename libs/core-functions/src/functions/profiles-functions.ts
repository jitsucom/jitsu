import { z } from "zod";
import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { getSingleton, parseNumber } from "juava";
import { MongoClient } from "mongodb";
import * as crypto from "crypto";
import { ensureMongoCollection } from "./lib/mongodb";

const hash = crypto["hash"];

export const ProfilesConfig = z.object({
  mongoUrl: z.string(),
  enableAnonymousProfiles: z.boolean().optional().default(false),
  profileWindowDays: z.number().default(365),
  eventsCollectionName: z.string().default("profiles-raw"),
});

export type ProfilesConfig = z.infer<typeof ProfilesConfig>;

const createClient = async (config: ProfilesConfig, ctx: FullContext) => {
  const mongoTimeout = parseNumber(process.env.MONGODB_TIMEOUT_MS, 1000);
  let uri = config.mongoUrl;
  ctx.log.info(`Connecting to MongoDB server.`);

  // Create a new MongoClient
  const client = new MongoClient(uri, {
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
  ctx.log.info(`Connected successfully to MongoDB server.`);
  return client;
};

export const ProfilesFunction: JitsuFunction<AnalyticsServerEvent, ProfilesConfig> = async (event, ctx) => {
  const config = ProfilesConfig.parse(ctx.props || {});
  if (!config.mongoUrl) {
    throw new Error("Missing required parameter 'mongoUrl'");
  }

  const userId = event.userId;
  if (!userId) {
    ctx.log.debug(`No userId found. Skipping`);
    return;
  }

  const mongoUrlHash = hash("md5", config.mongoUrl);

  try {
    const mongodb = getSingleton(
      `profiles-mongodb-${ctx.connection?.id}-${mongoUrlHash}`,
      () => {
        return createClient(config, ctx);
      },
      {
        optional: true,
        ttlSec: 60 * 60 * 24,
        cleanupFunc: client => client.close(),
      }
    );
    const mongo = await mongodb.waitInit();
    await ensureMongoCollection(mongo, config.eventsCollectionName, config.profileWindowDays, ["userId"]);
    const res = await mongo
      .db()
      .collection(config.eventsCollectionName)
      .insertOne(event, { writeConcern: { w: 1, journal: false } });
    if (!res.acknowledged) {
      ctx.log.error(`Failed to insert to MongoDB: ${JSON.stringify(res)}`);
    } else {
      ctx.log.debug(`Inserted to MongoDB: ${JSON.stringify(res)}`);
    }
  } catch (e: any) {
    throw new Error(`Error while sending event to MongoDB: ${e}`);
  }
};
