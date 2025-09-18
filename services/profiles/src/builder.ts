import {
  createClient,
  ProfileBuilder,
  mongodb,
  ProfilesConfig,
  pbEnsureMongoCollection,
  profileIdHashColumn,
  EventsStore,
  bulkerDestination,
  FunctionContext,
  FunctionChainContext,
  profileIdColumn,
  ProfileUser,
  Profile,
} from "@jitsu/core-functions";
import { FindCursor, AggregationCursor, MongoClient, WithId, Document, ReadPreference } from "mongodb";
import { db, ProfileBuilderQueueInfo } from "./lib/db";
import { getLog, getSingleton, hash, LogFactory, parseNumber, requireDefined, stopwatch, int32Hash } from "juava";
import NodeCache from "node-cache";
import { buildFunctionChain, FuncChain, runChain } from "./lib/functions-chain";
import { FullContext } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { TableNameParameter, transfer } from "@jitsu/functions-lib";
import { connectionsStore } from "./lib/repositories";
import { HighLevelProducer, OffsetSpec, TopicPartitionOffsetSpec } from "@confluentinc/kafka-javascript";
import { createPriorityConsumer, TopicsReport } from "./lib/priority-consumer";
import { kafkaAdmin, kafkaCredentials, topicName } from "./lib/kafka";
import { promProfileStatuses, promQueueProcessed, promQueueSize } from "./lib/metrics";

const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");

const fetchTimeoutMs = parseNumber(process.env.FETCH_TIMEOUT_MS, 2000);
export const metricsInterval = parseNumber(process.env.METRICS_INTERVAL_MS, 5000);

const instanceIndex = parseNumber(process.env.INSTANCE_INDEX, 0);
const priorityLevels = parseNumber(process.env.PRIORITY_LEVELS, 3);

//cache function chains for 1m
const funcsChainTTL = 60;
const funcsChainCache = new NodeCache({ stdTTL: funcsChainTTL, checkperiod: 60, useClones: false });

const funcCtx: FunctionContext = {
  function: {
    id: "profile-builder",
    type: "profile-builder",
  },
  props: {},
};

const bulkerSchema = {
  name: "profiles",
  fields: [
    {
      name: "profile_id",
      type: 4, //string. See bulker's DataType
    },
    {
      name: "traits",
      type: 6, //json
    },
    {
      name: "version",
      type: 2, //int. See bulker's DataType
    },
    {
      name: "updated_at",
      type: 5, // timestamp
    },
  ],
};

export type ProfileBuilderRunner = {
  close: () => Promise<void>;
  version: () => number;
};

export async function profileBuilder(
  workspaceId: string,
  profileBuilder: ProfileBuilder,
  eventsLogger: EventsStore
): Promise<ProfileBuilderRunner> {
  const pbLongId = `${workspaceId}-${profileBuilder.id}-v${profileBuilder.version}`;
  const log = getLog(`pb-${pbLongId}`);

  let closed = false;
  let closePromise: Promise<void> | undefined = undefined;

  const cacheKey = pbLongId;
  let funcChain: FuncChain | undefined = funcsChainCache.get(cacheKey);
  if (!funcChain) {
    log.atInfo().log(`Refreshing function chain`);
    funcChain = buildFunctionChain(profileBuilder, connectionsStore.getCurrent()!, eventsLogger, fetchTimeoutMs);
    funcsChainCache.set(cacheKey, funcChain);
  }

  const config = ProfilesConfig.parse({
    ...profileBuilder.intermediateStorageCredentials,
    profileBuilderId: profileBuilder.id,
    profileWindowDays: profileBuilder.connectionOptions.profileWindow,
    eventsDatabase: `profiles`,
    eventsCollectionName: `profiles-raw-${workspaceId}-${profileBuilder.id}`,
    traitsCollectionName: `profiles-traits-${workspaceId}-${profileBuilder.id}`,
  });

  const mongoSingleton = config.mongoUrl
    ? getSingleton(
        `profiles-mongodb-${profileBuilder.id}-${hash("md5", config.mongoUrl)}`,
        () => {
          log.atInfo().log(`Connecting to MongoDB server.`);
          const cl = createClient({
            mongoUrl: config.mongoUrl!,
          });
          log.atInfo().log(`Connected successfully to MongoDB server.`);
          return cl;
        },
        {
          optional: true,
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
    "updatedAt",
    true
  );

  const priorityConsumer = createPriorityConsumer(
    profileBuilder,
    priorityLevels,
    (profileId: string, priority: number) => {
      return () => processProfile(profileBuilder, funcChain!, mongo, log, config, profileId, priority);
    }
  );

  let timer: NodeJS.Timeout | undefined;
  if (instanceIndex === 0) {
    let previousOffsets: TopicsReport | undefined = undefined;
    timer = setInterval(async () => {
      reportQueueSize(profileBuilder, priorityLevels, previousOffsets)
        .then(r => {
          previousOffsets = r;
        })
        .catch(e => {
          log.atError().log(`Error while reporting queue size: ${e.message}`);
        });
    }, metricsInterval);
  }
  const startConsumer = async () => {
    log.atInfo().log("Starting consumer");
    return priorityConsumer.start();
  };
  const startFullRebuilder = async () => {
    log.atInfo().log("Starting full rebuilder");
    let closeResolve: ((value: void | PromiseLike<void>) => void) | undefined;
    let producer: HighLevelProducer | undefined;
    closePromise = new Promise((resolve, reject) => {
      closeResolve = resolve;
    });
    try {
      producer = new HighLevelProducer({
        "bootstrap.servers": kafkaCredentials.brokers.join(","),
        "allow.auto.create.topics": false,
        "linger.ms": 200,
      });
      producer.connect();
      const topic = topicName(profileBuilder.id, priorityLevels - 1);
      while (!closed) {
        const started = Date.now();
        const loadedState = await db.pgHelper().getProfileBuilderState(profileBuilder.id);

        if (typeof loadedState?.fullRebuildInfo?.profilesCount !== "undefined") {
          // sleep 5 sec
          await new Promise(resolve => setTimeout(resolve, 5 * 1000));
          continue;
        }
        log.atInfo().log(`Starting full rebuild for ${profileBuilder.id}`);
        try {
          let processed = 0;
          const producerCallback = (err, offset) => {
            if (err) {
              log.atError().log(`Error while producing message to Kafka: ${err.message}`);
            }
          };
          await processProfileIds(mongo, config, profileId => {
            producer!.produce(topic, null, null, profileId, Date.now(), producerCallback);
            processed++;
          });

          log.atInfo().log(`Processed ${processed} users in ${Date.now() - started}ms`);
          await db.pgHelper().updateProfileBuilderFullRebuildInfo(profileBuilder.id, {
            version: profileBuilder.version,
            timestamp: new Date(),
            profilesCount: processed,
          });
        } catch (e: any) {
          funcChain?.context.log.error(funcCtx, `Error while running profile builder: ${e.message}`);
        }
      }
    } finally {
      if (producer) {
        producer.disconnect();
      }
      if (closeResolve) {
        closeResolve();
      }
    }
  };

  const reportQueueSize = async function (
    profileBuilder: ProfileBuilder,
    priorityLevels: number,
    previousOffsets?: TopicsReport
  ): Promise<TopicsReport> {
    log.atDebug().log(`Reporting queue size for ${profileBuilder.id}`);
    const topics: TopicsReport = {};
    for (let i = 0; i < priorityLevels; i++) {
      const topic = topicName(profileBuilder.id, i);
      topics[topic] = {};
    }
    const { promise, resolve, reject } = createDeferred();

    kafkaAdmin.listConsumerGroupOffsets([{ groupId: "profile-builder-" + profileBuilder.id }], undefined, (e, data) => {
      if (e) {
        log
          .atError()
          .withCause(e)
          .log(`Failed to describe topics ${JSON.stringify(topics)}`);
        reject(e);
        return;
      }
      for (const group of data) {
        const partitions = group.partitions;
        for (const partition of partitions) {
          if (partition.error) {
            log
              .atError()
              .log(`Failed to get partition ${partition.topic}:${partition.partition} offset: ${partition.error}`);
            reject(partition.error);
            return;
          }
          const topic = topics[partition.topic];
          if (!topic) {
            continue;
          }
          const previousOffset = previousOffsets?.[partition.topic]?.[partition.partition]?.offset;
          const partitionInfo = topic[partition.partition];
          if (!partitionInfo) {
            topic[partition.partition] = { offset: partition.offset, highOffset: 0, previousOffset };
          } else {
            partitionInfo.offset = partition.offset;
            partitionInfo.previousOffset = previousOffset;
          }
        }
      }
      resolve();
    });
    await promise;

    const { promise: promise2, resolve: resolve2, reject: reject2 } = createDeferred();

    kafkaAdmin.describeTopics(Object.keys(topics), undefined, (e, data) => {
      if (e) {
        log
          .atError()
          .withCause(e)
          .log(`Failed to describe topics ${JSON.stringify(topics)}`);
        reject2(e);
        return;
      }
      const specs: TopicPartitionOffsetSpec[] = [];
      for (const topic of data) {
        if (topic.error) {
          log.atError().log(`Failed to describe topic ${topic.name} : ${topic.error}`);
          reject2(topic.error);
          return;
        }
        const partitions = topic.partitions;
        for (const partition of partitions) {
          specs.push({
            topic: topic.name,
            partition: partition.partition,
            offset: OffsetSpec.LATEST,
          });
        }
      }
      kafkaAdmin.listOffsets(specs, undefined, (e, data) => {
        if (e) {
          log
            .atError()
            .withCause(e)
            .log(`Failed to list offsets ${JSON.stringify(topics)}`);
          reject2(e);
          return;
        }
        for (const partition of data) {
          const topic = topics[partition.topic];
          const partitionInfo = topic[partition.partition];
          if (!partitionInfo) {
            topic[partition.partition] = { highOffset: partition.offset, offset: 0 };
          } else {
            partitionInfo.highOffset = partition.offset;
          }
        }
        resolve2();
      });
    });

    await promise2;

    const queues: ProfileBuilderQueueInfo["queues"] = {};
    for (let i = 0; i < priorityLevels; i++) {
      const name = topicName(profileBuilder.id, i);
      const topic = topics[name];
      const size = Object.values(topic).reduce((acc, partition) => {
        if (partition.highOffset) {
          return acc + (partition.highOffset - partition.offset);
        }
        return acc;
      }, 0);
      const processed = Object.values(topic).reduce((acc, partition) => {
        if (partition.previousOffset) {
          return acc + (partition.offset - partition.previousOffset);
        }
        return acc;
      }, 0);
      promQueueSize.labels({ builderId: profileBuilder.id, priority: i }).set(size);
      promQueueProcessed.labels({ builderId: profileBuilder.id, priority: i }).inc(processed);
      queues[i] = {
        priority: i,
        size,
        processed,
      };
    }
    log.atDebug().log(`Queue size: ${JSON.stringify(queues)}`);
    await db.pgHelper().updateProfileBuilderQueuesInfo(profileBuilder.id, {
      timestamp: new Date(),
      intervalSec: metricsInterval / 1000,
      queues,
    });
    return topics;
  };

  const pb = {
    close: async () => {
      closed = true;
      clearInterval(timer);
      const promises: Promise<void>[] = [priorityConsumer.close()];
      if (closePromise) {
        promises.push(closePromise);
      }
      await Promise.all(promises);
      log.atInfo().log("Closed");
    },
    version: () => profileBuilder.version,
  };
  if (instanceIndex === 0) {
    setImmediate(startFullRebuilder);
  }
  setImmediate(startConsumer);

  return pb;
}

async function processProfile(
  profileBuilder: ProfileBuilder,
  funcChain: FuncChain,
  mongo: MongoClient,
  log: LogFactory,
  config: ProfilesConfig,
  profileId: string,
  priority: number = 0
) {
  const ms = stopwatch();
  let status = "success";
  let cursor: FindCursor<WithId<Document>>;
  try {
    const metrics = { db_events: 0 } as any;
    cursor = await getProfileEvents(mongo, config, profileId);
    metrics.db_find = ms.lapMs();
    const userPromise = getProfileUser(mongo, config, profileId, metrics);
    let count = 0;
    const userProvider = async () => {
      return await userPromise;
    };

    const eventsProvider = async () => {
      const start = Date.now();
      const next = await cursor.next();
      metrics.db_events += Date.now() - start;
      if (next) {
        count++;
        return next as unknown as AnalyticsServerEvent;
      } else {
        return undefined;
      }
    };

    const result = await runChain(profileBuilder, profileId, funcChain, eventsProvider, userProvider);
    metrics.udf = ms.lapMs();
    metrics.db = metrics.db_events + metrics.db_user + metrics.db_find;
    if (result) {
      await sendToBulker(profileBuilder, result, funcChain.context);
      metrics.bulker = ms.lapMs();
      funcChain.context.log.info(
        funcCtx,
        `User ${profileId} processed in ${ms.elapsedMs()}ms (events: ${count}). Result: ${JSON.stringify(
          result
        )} Metrics: ${JSON.stringify(metrics)}`
      );
    } else {
      funcChain.context.log.warn(
        funcCtx,
        `No profile result for user ${profileId}. processed in ${ms.elapsedMs()}ms (events: ${count}).  Metrics: ${JSON.stringify(
          metrics
        )}`
      );
    }
  } catch (e: any) {
    status = "error";
    funcChain.context.log.error(funcCtx, `Error while processing user ${profileId}: ${e.message}`);
  } finally {
    // @ts-ignore
    cursor?.close();
    promProfileStatuses.labels({ builderId: profileBuilder.id, priority, status }).observe(ms.elapsedMs() / 1000);
  }
}

async function sendToBulker(profileBuilder: ProfileBuilder, profile: Profile, context: FunctionChainContext) {
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
    getWarehouse: () => {
      throw new Error("Warehouse API is not available in builtin functions");
    },
    props: {
      bulkerEndpoint: bulkerBase,
      destinationId: profile.destination_id || profileBuilder.destinationId,
      authToken: bulkerAuthKey,
      dataLayout: "passthrough",
      streamOptions: {
        primaryKey: "profile_id",
        schema: JSON.stringify(bulkerSchema),
      },
    },
    connection: {
      id: profile.destination_id || profileBuilder.destinationId,
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
    receivedAt: new Date(),
    workspace: { id: profileBuilder.workspaceId },
  };
  const payload = {
    [TableNameParameter]: profile.table_name || "profiles",
  };
  transfer(payload, profile, ["destination_id", "table_name"]);

  await bulkerDestination.default(payload as unknown as AnalyticsServerEvent, ctx);
}

async function getProfileEvents(mongo: MongoClient, config: ProfilesConfig, profileId: string) {
  return mongo
    .db(config.eventsDatabase)
    .collection(config.eventsCollectionName)
    .find(
      {
        [profileIdHashColumn]: int32Hash(profileId),
        [profileIdColumn]: profileId,
      },
      { readPreference: ReadPreference.NEAREST }
    );
}

async function getProfileUser(
  mongo: MongoClient,
  config: ProfilesConfig,
  profileId: string,
  metrics: any
): Promise<ProfileUser> {
  const start = Date.now();
  const u = await mongo
    .db(config.eventsDatabase)
    .collection(config.traitsCollectionName)
    .findOne({ [profileIdColumn]: profileId }, { readPreference: ReadPreference.NEAREST });
  metrics.db_user = Date.now() - start;
  if (!u) {
    return {
      profileId,
      userId: "",
      anonymousId: "",
      traits: {},
    };
  } else {
    return {
      profileId,
      userId: u.userId,
      anonymousId: u.anonymousId,
      traits: u.traits,
    };
  }
}

async function processProfileIds(mongo: MongoClient, config: ProfilesConfig, cb: (profileId: string) => void) {
  let cursor: AggregationCursor<Document>;
  try {
    cursor = mongo
      .db(config.eventsDatabase)
      .collection(config.eventsCollectionName)
      .aggregate([
        {
          $group: {
            _id: "$" + profileIdColumn,
          },
        },
      ])
      .withReadPreference(ReadPreference.NEAREST);
    for await (const doc of cursor) {
      cb(doc._id);
    }
  } finally {
    // @ts-ignore
    cursor?.close();
  }
}

function createDeferred() {
  let resolve, reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
