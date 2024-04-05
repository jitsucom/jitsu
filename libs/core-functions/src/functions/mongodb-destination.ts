import { FunctionLogger, JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { getSingleton } from "juava";
import { MongoClient } from "mongodb";
import { MongodbDestinationConfig } from "../meta";
import { createFetchWrapper, createFunctionLogger, JitsuFunctionWrapper } from "./lib";

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

const createClient = async (config: MongodbDestinationConfig, log: FunctionLogger) => {
  let uri = config.url ?? buildUrl(config);
  log.info(`Connecting to MongoDB server: ${config.hosts?.join(",")}`);

  // Create a new MongoClient
  const client = new MongoClient(uri);
  // Connect the client to the server (optional starting in v4.7)
  await client.connect();
  // Establish and verify connection
  await client.db(config.database).command({ ping: 1 });
  log.info(`Connected successfully to MongoDB server: ${config.hosts?.join(",")}`);
  return client;
};

const MongodbDestination: JitsuFunctionWrapper<AnalyticsServerEvent, MongodbDestinationConfig> = (
  chainCtx,
  funcCtx
) => {
  const log = createFunctionLogger(chainCtx, funcCtx);
  const props = funcCtx.props;

  const func: JitsuFunction<AnalyticsServerEvent> = async (event, ctx) => {
    try {
      const mongodb = getSingleton(
        `mongodb-client-${ctx.destination?.id}-${ctx.destination?.hash}`,
        () => {
          return createClient(props, log);
        },
        {
          ttlSec: 60 * 60 * 24,
          cleanupFunc: client => client.close(),
        }
      );
      const mongo = await mongodb.waitInit();
      const collection = mongo.db().collection(props.collection);
      const res = await collection.insertOne(event);
      log.debug(`Inserted to MongoDB: ${JSON.stringify(res)}`);
    } catch (e: any) {
      throw new RetryError(`Error while sending event to MongoDB: ${e}`);
    }
  };

  func.displayName = "mongodb-destination";

  return func;
};

export default MongodbDestination;
