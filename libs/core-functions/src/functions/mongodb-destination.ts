import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { getSingleton } from "juava";
import { MongoClient } from "mongodb";
import { MongodbDestinationConfig } from "../meta";

const buildUrl = (config: MongodbDestinationConfig) => {
  if (!config.hosts) {
    throw new Error("Hosts are not specified");
  }
  if (!config.database) {
    throw new Error("Database is not specified");
  }
  let uri = config.protocol + "://";
  if (config.username && config.password) {
    uri += config.username + ":" + config.password + "@";
  }
  uri += config.hosts.join(",");
  uri += "/" + config.database;
  if (config.options) {
    uri += "?" + new URLSearchParams(config.options).toString();
  }
  return uri;
};

const createClient = async (config: MongodbDestinationConfig, ctx: FullContext) => {
  let uri = config.url ?? buildUrl(config);
  ctx.log.info(`Connecting to MongoDB server: ${config.hosts?.join(",")}`);

  // Create a new MongoClient
  const client = new MongoClient(uri);
  // Connect the client to the server (optional starting in v4.7)
  await client.connect();
  // Establish and verify connection
  await client.db(config.database).command({ ping: 1 });
  ctx.log.info(`Connected successfully to MongoDB server: ${config.hosts?.join(",")}`);
  return client;
};

const MongodbDestination: JitsuFunction<AnalyticsServerEvent, MongodbDestinationConfig> = async (event, ctx) => {
  try {
    const mongodb = getSingleton(
      `mongodb-client-${ctx.destination?.id}-${ctx.destination?.hash}`,
      () => {
        return createClient(ctx.props, ctx);
      },
      {
        ttlSec: 60 * 60 * 24,
        cleanupFunc: client => client.close(),
      }
    );
    const mongo = await mongodb.waitInit();
    const collection = mongo.db().collection(ctx.props.collection);
    const res = await collection.insertOne(event);
    ctx.log.debug(`Inserted to MongoDB: ${JSON.stringify(res)}`);
  } catch (e) {
    ctx.log.error(`Error while sending event to MongoDB: ${e}`);
  }
};

MongodbDestination.displayName = "mongodb-destination";

export default MongodbDestination;
