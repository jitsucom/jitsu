import {
  createClient,
  ProfileBuilder,
  mongodb,
  ProfilesConfig,
  pbEnsureMongoCollection,
  profilePartitionIdColumn,
  profilePartitionsCount,
  EventsStore,
  bulkerDestination,
  FunctionContext,
  FunctionChainContext,
} from "@jitsu/core-functions";
import { MongoClient, ObjectId } from "mongodb";
import { db, ProfileBuilderState } from "./lib/db";
import { getLog, getSingleton, hash, LogFactory, requireDefined, stopwatch } from "juava";
import PQueue from "p-queue";
import NodeCache from "node-cache";
import { functionsStore } from "./lib/repositories";
import { buildFunctionChain, FuncChain, runChain } from "./lib/functions-chain";
import { FullContext } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { ProfileUser } from "./lib/profiles-udf-wrapper";

const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");

const instanceIndex = process.env.INSTANCE_INDEX ? parseInt(process.env.INSTANCE_INDEX, 10) : 0;
const totalInstances = process.env.INSTANCES_COUNT ? parseInt(process.env.INSTANCES_COUNT, 10) : 1;
const partitionsRange = selectPartitions(profilePartitionsCount, totalInstances, instanceIndex);

//cache function chains for 1m
const funcsChainTTL = 60;
const funcsChainCache = new NodeCache({ stdTTL: funcsChainTTL, checkperiod: 60, useClones: false });

console.log(
  `Starting profile builder with instance index ${instanceIndex} of ${totalInstances} and partitions range ${partitionsRange}`
);

export type ProfileBuilderRunner = {
  start: () => Promise<void>;
  close: () => Promise<void>;
  version: () => number;
  state: () => ProfileBuilderState;
};

export async function profileBuilder(
  workspaceId: string,
  profileBuilder: ProfileBuilder,
  eventsLogger: EventsStore
): Promise<ProfileBuilderRunner> {
  const log = getLog(`pb-${workspaceId}-${profileBuilder.id}`);
  let state: ProfileBuilderState = {
    profileBuilderId: profileBuilder.id,
    profileBuilderVersion: profileBuilder.version,
    startedAt: new Date(),
    updatedAt: new Date(),
    lastTimestamp: undefined,
    instanceIndex,
    totalInstances,
    processedUsers: 0,
    errorUsers: 0,
    totalUsers: 0,
    speed: 0,
  };
  let closed = false;
  let closeResolve;
  const closePromise = new Promise((resolve, reject) => {
    closeResolve = resolve;
  });

  const funcStore = await functionsStore.get();

  const cacheKey = `${profileBuilder.id}_${profileBuilder.version}`;
  let funcChain: FuncChain | undefined = funcsChainCache.get(cacheKey);
  if (!funcChain) {
    log.atDebug().log(`[${profileBuilder.id}] Refreshing function chain. version: ${profileBuilder.version}`);
    funcChain = buildFunctionChain(profileBuilder, funcStore, eventsLogger);
    funcsChainCache.set(cacheKey, funcChain);
  }

  const config = ProfilesConfig.parse(profileBuilder.intermediateStorageCredentials || {});

  config.eventsDatabase = `profiles`;
  config.eventsCollectionName = `profiles-raw-${workspaceId}-${profileBuilder.id}`;

  const mongoSingleton = config.mongoUrl
    ? getSingleton(
        `profiles-mongodb-${profileBuilder.id}-${hash("md5", config.mongoUrl)}`,
        () => {
          log.atInfo().log(`Connecting to MongoDB server.`);
          const cl = createClient({
            mongoUrl: config.mongoUrl,
          } as ProfilesConfig);
          log.atInfo().log(`Connected successfully to MongoDB server.`);
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
    profilePartitionIdColumn,
    "userId",
  ]);

  const loadedState = await db
    .pgHelper()
    .getProfileBuilderState(profileBuilder.id, profileBuilder.version, totalInstances, instanceIndex);

  state.lastTimestamp = loadedState?.lastTimestamp;

  log.atInfo().log(`Last timestamp: ${state.lastTimestamp}`);

  const queue = new PQueue({ concurrency: 20 });

  const pb = {
    start: async () => {
      log.atInfo().log("Started");
      while (!closed) {
        const started = Date.now();
        try {
          const users = await getUsersHavingEventsSince(mongo, config, state.lastTimestamp);
          log.atInfo().log(`Found ${users.length} users to process: ${users}`);
          state.totalUsers = users.length;
          state.processedUsers = 0;
          state.errorUsers = 0;
          state.speed = 0;
          const timestampEnd = new Date();
          timestampEnd.setSeconds(timestampEnd.getSeconds() - 1);
          state.lastTimestamp = timestampEnd;

          for (let i = 0; i < users.length; i++) {
            if (i % 100) {
              await db.pgHelper().updateProfileBuilderState(state);
            }
            const user = users[i];
            log.atInfo().log(`Processing user ${i + 1}/${users.length}: ${user}`);
            await queue.onEmpty();
            queue.add(async () =>
              processUser(profileBuilder, state, funcChain!, mongo, log, config, user, timestampEnd)
            );
          }
          await queue.onIdle();
          state.speed = users.length / ((Date.now() - started) / 1000);
          await db.pgHelper().updateProfileBuilderState(state);
        } catch (e) {
          log.atError().withCause(e).log(`Error while running profile builder`);
        }
        const waitMs = config.runPeriodSec * 1000 - (Date.now() - started);
        if (waitMs > 0) {
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }
      closeResolve();
    },
    close: async () => {
      closed = true;
      await Promise.all([queue.onIdle(), closePromise]);
    },
    version: () => profileBuilder.version,
    state: () => state,
  };

  setImmediate(pb.start);

  return pb;
}

async function processUser(
  profileBuilder: ProfileBuilder,
  state: ProfileBuilderState,
  funcChain: FuncChain,
  mongo: MongoClient,
  log: LogFactory,
  config: ProfilesConfig,
  userId: string,
  endTimestamp: Date
) {
  const ms = stopwatch();
  const funcCtx: FunctionContext = {
    function: {
      id: "PIPELINE",
      type: "udf",
    },
    props: {},
  };
  try {
    const events = await getUserEvents(mongo, config, userId, endTimestamp);
    const eventsArray = await events.toArray();
    const user = { traits: {}, userId } as ProfileUser;
    eventsArray
      .filter(e => e.type === "identify")
      .forEach(e => {
        if (e.anonymousId) {
          user.anonymousId = e.anonymousId;
        }
        if (e.traits) {
          Object.assign(user.traits, e.traits);
        }
      });
    const result = await runChain(funcChain, eventsArray, user);
    if (result) {
      const profile = {
        user_id: userId,
        traits: user.traits,
        custom_properties: result.properties,
        updated_at: new Date(),
      };
      await sendToBulker(profileBuilder, profile, funcChain.context, funcCtx);
      funcChain.context.log.info(
        funcCtx,
        `User ${userId} processed in ${ms.elapsedMs()}ms (events: ${eventsArray.length}). Result: ${JSON.stringify(
          profile
        )}`
      );
    } else {
      funcChain.context.log.warn(
        funcCtx,
        `No profile result for user ${userId}. processed in ${ms.elapsedMs()}ms (events: ${eventsArray.length}).`
      );
    }
    state.processedUsers++;
  } catch (e: any) {
    state.errorUsers++;
    funcChain.context.log.error(funcCtx, `Error while processing user ${userId}: ${e.message}`);
  }
}

async function sendToBulker(
  profileBuilder: ProfileBuilder,
  profile: any,
  context: FunctionChainContext,
  funcCtx: FunctionContext
) {
  const ctx: FullContext<bulkerDestination.BulkerDestinationConfig> = {
    log: {
      error: (message: string, ...args: any[]) => {
        context.log.error(funcCtx, message, ...args);
      },
      info: (message: string, ...args: any[]) => {
        context.log.info(funcCtx, message, ...args);
      },
      warn: (message: string, ...args: any[]) => {
        context.log.warn(funcCtx, message, ...args);
      },
      debug: (message: string, ...args: any[]) => {
        context.log.debug(funcCtx, message, ...args);
      },
    },
    fetch: context.fetch,
    store: context.store,
    props: {
      bulkerEndpoint: bulkerBase,
      destinationId: profileBuilder.id,
      authToken: bulkerAuthKey,
      dataLayout: "passthrough",
    },
    connection: {
      id: profileBuilder.id,
    },
    destination: {
      id: profileBuilder.destinationId,
      type: "",
      hash: "",
    },
    source: {
      id: "",
      type: "s2s",
    },
    headers: {},
    workspace: { id: profileBuilder.workspaceId },
  };
  await bulkerDestination.default(
    { [bulkerDestination.TableNameParameter]: "profiles", ...profile } as unknown as AnalyticsServerEvent,
    ctx
  );
}

async function getUserEvents(mongo: MongoClient, config: ProfilesConfig, userId: string, endTimestamp: Date) {
  return mongo
    .db(config.eventsDatabase)
    .collection(config.eventsCollectionName)
    .find({
      [profilePartitionIdColumn]: { $gte: partitionsRange[0], $lte: partitionsRange[1] },
      userId: userId,
      _id: { $lt: new ObjectId(Math.floor(endTimestamp.getTime() / 1000).toString(16) + "0000000000000000") },
    });
}

async function getUsersHavingEventsSince(mongo: MongoClient, config: ProfilesConfig, lastTimestamp?: Date) {
  let dateFilter = {};
  if (lastTimestamp) {
    dateFilter = {
      _id: { $gte: new ObjectId(Math.floor(lastTimestamp.getTime() / 1000).toString(16) + "0000000000000000") },
    };
  }
  return await mongo
    .db(config.eventsDatabase)
    .collection(config.eventsCollectionName)
    .aggregate([
      {
        $match: {
          ...dateFilter,
          [profilePartitionIdColumn]: { $gte: partitionsRange[0], $lte: partitionsRange[1] },
        },
      },
      {
        $group: {
          _id: "$userId",
        },
      },
    ])
    .map(e => e._id as string)
    .toArray();
}

function selectPartitions(totalPartitions: number, totalInstances: number, instanceIndex: number): [number, number] {
  const partitionsPerInstance = Math.floor(totalPartitions / totalInstances);
  const remainderPartitions = totalPartitions % totalInstances;

  const ranges: Array<{ instance: number; partitionRange: [number, number] }> = [];
  let startPartition = 0;

  for (let i = 0; i < totalInstances; i++) {
    // Each instance gets at least `partitionsPerInstance` partitions
    // If there are remaining partitions, distribute one extra to some instances
    const additionalPartition = i < remainderPartitions ? 1 : 0;
    const endPartition = startPartition + partitionsPerInstance + additionalPartition - 1;

    ranges.push({
      instance: i,
      partitionRange: [startPartition, endPartition],
    });

    startPartition = endPartition + 1;
  }

  return ranges[instanceIndex].partitionRange;
}
