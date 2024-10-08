import {
  createClient,
  ProfileBuilder,
  mongodb,
  ProfilesConfig,
  pbEnsureMongoCollection,
  profilePartitionIdColumn,
  profilePartitionsCount,
} from "@jitsu/core-functions";
import { MongoClient, ObjectId } from "mongodb";
import { db, ProfileBuilderState } from "./lib/db";
import { getLog, getSingleton, hash } from "juava";
import PQueue from "p-queue";

const instanceIndex = process.env.INSTANCE_INDEX ? parseInt(process.env.INSTANCE_INDEX, 10) : 0;
const totalInstances = process.env.INSTANCES_COUNT ? parseInt(process.env.INSTANCES_COUNT, 10) : 1;
const partitionsRange = selectPartitions(profilePartitionsCount, totalInstances, instanceIndex);

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
  profileBuilder: ProfileBuilder
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
    totalUsers: 0,
    speed: 0,
  };
  let closed = false;
  let closeResolve;
  const closePromise = new Promise((resolve, reject) => {
    closeResolve = resolve;
  });
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

  const queue = new PQueue({ concurrency: 10 });
  const onSizeLessThan = async (limit: number) => {
    // Instantly resolve if the queue is empty.
    if (queue.size < limit) {
      return;
    }
    return new Promise<void>(resolve => {
      const listener = () => {
        if (queue.size < limit) {
          queue.removeListener("next", listener);
          resolve();
        }
      };
      queue.on("next", listener);
    });
  };
  const closeQueue = async () => {
    log.atInfo().log("Closing queue...");
    await queue.onIdle();
  };

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
            await onSizeLessThan(1);
            queue.add(async () => processUser(mongo, config, user, timestampEnd));
          }
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
      await Promise.all([closeQueue(), closePromise]);
    },
    version: () => profileBuilder.version,
    state: () => state,
  };

  setImmediate(pb.start);

  return pb;
}

async function processUser(mongo: MongoClient, config: ProfilesConfig, userId: string, endTimestamp: Date) {
  const events = await getUserEvents(mongo, config, userId, endTimestamp);
  for await (const event of events) {
    console.log(`Event for user ${userId}: ${event.messageId}`);
  }
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
