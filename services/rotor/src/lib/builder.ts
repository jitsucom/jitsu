import { ProfileBuilder, EventsStore, bulkerDestination } from "@jitsu/destination-functions";
import { AggregationCursor, MongoClient, Document, ReadPreference } from "mongodb";
import { db, ProfileBuilderQueueInfo } from "./db";
import { getLog, getSingleton, hash, LogFactory, LogLevel, parseNumber, requireDefined, stopwatch } from "juava";
import { FullContext } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { TableNameParameter, transfer } from "@jitsu/functions-lib";
import { HighLevelProducer, OffsetSpec, TopicPartitionOffsetSpec } from "@confluentinc/kafka-javascript";
import { createPriorityConsumer, TopicsReport } from "./priority-consumer";
import { kafkaAdmin, kafkaCredentials, topicName } from "./kafka";
import { promProfileStatuses, promQueueProcessed, promQueueSize } from "./metrics";
import { getServerEnv } from "../serverEnv";
import {
  createClient,
  pbEnsureMongoCollection,
  profileIdColumn,
  profileIdHashColumn,
  ProfilesConfig,
} from "./profiles-functions";
import { mongodb } from "./mongodb";
import { Profile } from "./pb-server-runtime";
import { undiciAgent } from "./functions-server-client";
import { workspacesStore } from "./repositories";

const serverEnv = getServerEnv();

const bulkerBase = requireDefined(serverEnv.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(serverEnv.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");

const fetchTimeoutMs = parseNumber(serverEnv.FETCH_TIMEOUT_MS, 2000);
export const metricsInterval = parseNumber(serverEnv.METRICS_INTERVAL_MS, 5000);

const instanceIndex = parseNumber(serverEnv.INSTANCE_INDEX, 0);
const priorityLevels = parseNumber(serverEnv.PRIORITY_LEVELS, 3);

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

  const config = ProfilesConfig.parse({
    ...profileBuilder.intermediateStorageCredentials,
    profileBuilderId: profileBuilder.id,
    profileWindowDays: profileBuilder.connectionOptions.profileWindow,
    eventsDatabase: `profiles`,
    eventsCollectionName: `profiles-raw-${workspaceId}-${profileBuilder.id}`,
    traitsCollectionName: `profiles-traits-${workspaceId}-${profileBuilder.id}`,
  });

  // MongoDB is still needed for full rebuilds (processProfileIds) and collection setup
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
      return () => processProfile(workspaceId, profileBuilder, log, eventsLogger, profileId, priority);
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
          log.atError().log(`Error while running profile builder: ${e.message}`);
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
  workspaceId: string,
  profileBuilder: ProfileBuilder,
  log: LogFactory,
  eventsLogger: EventsStore,
  profileId: string,
  priority: number = 0
) {
  const ms = stopwatch();
  let status = "success";
  try {
    // Look up functionsServerInfo fresh from repository on each invocation —
    // deploymentId may change without a profile builder version bump
    const ws = workspacesStore.getCurrent();
    const currentWorkspace = ws?.getObject(workspaceId);
    const currentPb = currentWorkspace?.profileBuilders?.find((pb: any) => pb.id === profileBuilder.id);
    const functionsServerInfo = (currentPb as any)?.functionsServer as { deploymentId: string } | undefined;
    if (!functionsServerInfo?.deploymentId) {
      throw new Error(`No functions server deployment configured for profile builder ${profileBuilder.id}`);
    }

    // Call functions server to execute profile builder chain
    const template = serverEnv.FUNCTIONS_SERVER_URL_TEMPLATE;
    const baseUrl = template.replace("${workspaceId}", functionsServerInfo.deploymentId);
    const url = `${baseUrl}/profile/${profileBuilder.id}`;
    const fsTimeoutMs = parseNumber(serverEnv.FUNCTIONS_SERVER_TIMEOUT_MS, 30000);

    const { request } = await import("undici");
    const response = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
      bodyTimeout: fsTimeoutMs,
      headersTimeout: fsTimeoutMs,
      dispatcher: undiciAgent,
    });

    let fsResult: {
      result?: Profile;
      error?: { name: string; message: string };
      logs?: any[];
    };

    const bodyText = await response.body.text();
    try {
      fsResult = JSON.parse(bodyText);
    } catch {
      throw new Error(`Functions server returned ${response.statusCode}: ${bodyText}`);
    }

    // Replay function logs to eventsLogger (same pattern as functions-server-client.ts)
    if (fsResult.logs && fsResult.logs.length > 0) {
      const connectionId = profileBuilder.id;
      for (const entry of fsResult.logs) {
        const functionId = entry.functionId || profileBuilder.id;
        const functionType = entry.functionType || "profile";

        if (typeof entry.message === "object" && entry.message.type === "http-request") {
          // HTTP request logs are sent directly to eventsLogger
          eventsLogger.log(connectionId, entry.level as LogLevel, entry.message);
        } else {
          // Regular logs: send to eventsLogger in the standard format
          eventsLogger.log(connectionId, entry.level as LogLevel, {
            type: `log-${entry.level}`,
            functionId,
            functionType,
            message: {
              text: entry.message,
              args: entry.args,
            },
          });
        }
      }
    }

    if (response.statusCode !== 200) {
      throw new Error(`Functions server returned ${response.statusCode}: ${fsResult.error?.message || bodyText}`);
    }

    if (fsResult.error) {
      throw new Error(`${fsResult.error.name}: ${fsResult.error.message}`);
    }

    const result = fsResult.result;
    if (result) {
      await sendToBulker(profileBuilder, result);
      log.atInfo().log(`User ${profileId} processed in ${ms.elapsedMs()}ms. Result: ${JSON.stringify(result)}`);
    } else {
      log.atWarn().log(`No profile result for user ${profileId}. processed in ${ms.elapsedMs()}ms`);
    }
  } catch (e: any) {
    status = "error";
    log.atError().log(`Error while processing user ${profileId}: ${e.message}`);
  } finally {
    promProfileStatuses.labels({ builderId: profileBuilder.id, priority, status }).observe(ms.elapsedMs() / 1000);
  }
}

async function sendToBulker(profileBuilder: ProfileBuilder, profile: Profile) {
  const log = getLog(`pb-bulker-${profileBuilder.id}`);
  const ctx: FullContext<bulkerDestination.BulkerDestinationConfig> = {
    log: {
      error: (message: string, ...args: any[]) => log.atError().log(message, ...args),
      info: (message: string, ...args: any[]) => log.atInfo().log(message, ...args),
      warn: (message: string, ...args: any[]) => log.atWarn().log(message, ...args),
      debug: (message: string, ...args: any[]) => log.atDebug().log(message, ...args),
    },
    fetch: globalThis.fetch,
    store: { get: async () => undefined, set: async () => {}, del: async () => {}, ttl: async () => {} } as any,
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
