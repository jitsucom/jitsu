import { getLog } from "juava";
import { connectToKafka, deatLetterTopic, KafkaCredentials, retryTopic } from "./kafka-config";
import Prometheus from "prom-client";
import PQueue from "p-queue";
const concurrency = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY) : 10;
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import { getRetryPolicy, retryBackOffTime, retryLogMessage } from "./retries";
import { createMetrics, Metrics } from "./metrics";
import { FuncChainResult } from "./functions-chain";
import type { Admin, Consumer, Producer, KafkaMessage } from "kafkajs";
import { CompressionTypes } from "kafkajs";
import { GeoResolver } from "./maxmind";

const log = getLog("kafka-rotor");

const RETRY_TIME_HEADER = "retry_time";
const RETRY_COUNT_HEADER = "retries";
const ERROR_HEADER = "error";
const ORIGINAL_TOPIC_HEADER = "original_topic";
const FUNCTION_ID_HEADER = "function_id";
export const CONNECTION_IDS_HEADER = "connection_ids";

export type KafkaRotorConfig = {
  credentials: KafkaCredentials;
  consumerGroupId: string;
  kafkaTopics: string[];
  kafkaClientId?: string;
  geoResolver?: GeoResolver;
  handle: (
    message: string,
    headers?,
    metrics?: Metrics,
    geoResolver?: GeoResolver,
    functionsFilter?: (id: string) => boolean,
    retries?: number
  ) => Promise<FuncChainResult | undefined>;
};

export type KafkaRotor = {
  start: () => Promise<Metrics>;
  close: () => Promise<void>;
};

export function kafkaRotor(cfg: KafkaRotorConfig): KafkaRotor {
  const { kafkaTopics, consumerGroupId, handle, kafkaClientId = "kafka-rotor", geoResolver } = cfg;
  let consumer: Consumer;
  let producer: Producer;
  let admin: Admin;
  let closeQueue: () => Promise<void>;
  let interval: NodeJS.Timer;
  let metrics: Metrics;
  return {
    start: async () => {
      const kafka = connectToKafka({ defaultAppId: kafkaClientId, ...cfg.credentials });
      consumer = kafka.consumer({
        groupId: consumerGroupId,
        allowAutoTopicCreation: false,
        sessionTimeout: 120000,
      });
      await consumer.connect();
      log.atInfo().log("Subscribing to kafka topics: ", kafkaTopics);
      await consumer.subscribe({ topics: kafkaTopics, fromBeginning: true });

      producer = kafka.producer({ allowAutoTopicCreation: false });
      await producer.connect();
      metrics = createMetrics(producer);
      admin = kafka.admin();

      const topicOffsets = new Prometheus.Gauge({
        name: "rotor_topic_offsets2",
        help: "topic offsets",
        // add `as const` here to enforce label names
        labelNames: ["topic", "partition", "offset"] as const,
      });
      const messagesConsumed = new Prometheus.Counter({
        name: "rotor_messages_consumed",
        help: "messages consumed",
        // add `as const` here to enforce label names
        labelNames: ["topic", "partition"] as const,
      });
      const messagesProcessed = new Prometheus.Counter({
        name: "rotor_messages_processed",
        help: "messages processed",
        // add `as const` here to enforce label names
        labelNames: ["topic", "partition"] as const,
      });
      const messagesRequeued = new Prometheus.Counter({
        name: "rotor_messages_requeued",
        help: "messages requeued",
        // add `as const` here to enforce label names
        labelNames: ["topic"] as const,
      });
      const messagesDeadLettered = new Prometheus.Counter({
        name: "rotor_messages_dead_lettered",
        help: "messages dead lettered",
        // add `as const` here to enforce label names
        labelNames: ["topic"] as const,
      });
      interval = setInterval(async () => {
        try {
          for (const topic of kafkaTopics) {
            const watermarks = await admin.fetchTopicOffsets(topic);
            for (const o of watermarks) {
              topicOffsets.set({ topic: topic, partition: o.partition, offset: "high" }, parseInt(o.high));
              topicOffsets.set({ topic: topic, partition: o.partition, offset: "low" }, parseInt(o.low));
            }
          }
          const offsets = await admin.fetchOffsets({ groupId: consumerGroupId, topics: kafkaTopics });
          for (const o of offsets) {
            for (const p of o.partitions) {
              topicOffsets.set({ topic: o.topic, partition: p.partition, offset: "offset" }, parseInt(p.offset));
            }
          }
        } catch (e) {
          log.atError().withCause(e).log("Failed to commit offsets");
        }
      }, 60000);

      async function onMessage(message: KafkaMessage, topic: string, partition: number) {
        messagesConsumed.inc({ topic, partition });
        const value = message.value;
        if (!value) {
          return;
        }
        const headers = message.headers || {};
        const retries = headers[RETRY_COUNT_HEADER] ? parseInt(headers[RETRY_COUNT_HEADER].toString()) : 0;
        const retriedFunctionId = headers[FUNCTION_ID_HEADER] ? headers[FUNCTION_ID_HEADER].toString() : "";
        const connectionIds =
          headers && headers[CONNECTION_IDS_HEADER] ? headers[CONNECTION_IDS_HEADER].toString().split(",") : [""];
        const conProms = connectionIds.map(connectionId =>
          handle(
            value.toString(),
            {
              ...headers,
              [CONNECTION_IDS_HEADER]: connectionId,
            },
            metrics,
            geoResolver,
            retriedFunctionId
              ? id => {
                  if (retriedFunctionId.startsWith("udf.")) {
                    return id.startsWith("udf.") || id.startsWith("builtin.destination.");
                  } else if (retriedFunctionId.startsWith("builtin.destination.")) {
                    return id.startsWith("builtin.destination.");
                  } else {
                    return true;
                  }
                }
              : undefined,
            retries
          )
            .then(() => messagesProcessed.inc({ topic, partition }))
            .catch(async e => {
              const retryPolicy = getRetryPolicy(e);
              const retryTime = retryBackOffTime(retryPolicy, retries + 1);
              const newMessage = e.event
                ? JSON.stringify({ ...JSON.parse(value.toString()), httpPayload: e.event })
                : value;
              log
                .atError()
                .withCause(e)
                .log(
                  `Failed to process function ${e.functionId} for connection ${connectionId} messageId: ${
                    message.key || "(no key set)"
                  }. ${retryLogMessage(retryPolicy, retries)}`
                );
              if (!retryTime) {
                messagesDeadLettered.inc({ topic });
              } else {
                messagesRequeued.inc({ topic });
              }
              const requeueTopic = retryTime ? retryTopic() : deatLetterTopic();
              try {
                await producer.send({
                  topic: requeueTopic,
                  compression: getCompressionType(),
                  messages: [
                    {
                      value: newMessage,
                      // on first retry we create a new key so if more than one destination fails - they will be retried independently
                      key: retries === 0 ? `${message.key}_${connectionId}` : message.key,
                      headers: {
                        [ERROR_HEADER]: e.message,
                        [RETRY_COUNT_HEADER]: `${retries}`,
                        [ORIGINAL_TOPIC_HEADER]: topic,
                        [RETRY_TIME_HEADER]: retryTime,
                        [CONNECTION_IDS_HEADER]: connectionId,
                        ...(e.functionId ? { [FUNCTION_ID_HEADER]: e.functionId } : {}),
                      },
                    },
                  ],
                });
              } catch (e) {
                log.atDebug().withCause(e).log(`Failed to put message to ${topic}: ${message.value}`);
              }
            })
        );
        await Promise.all(conProms);
      }

      const queue = new PQueue({ concurrency });

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
      closeQueue = async () => {
        log.atInfo().log("Closing queue...");
        await queue.onIdle();
      };

      await consumer.run({
        autoCommitInterval: 10000,
        autoCommit: true,
        partitionsConsumedConcurrently: 4,
        eachMessage: async ({ message, topic, partition }) => {
          //make sure that queue has no more entities than concurrency limit (running tasks not included)
          await onSizeLessThan(concurrency);
          queue.add(async () => onMessage(message, topic, partition));
        },
        // eachBatch: async ({
        //   batch,
        //   resolveOffset,
        //   heartbeat,
        //   isRunning,
        //   isStale,
        //   commitOffsetsIfNecessary,
        //   uncommittedOffsets,
        // }) => {
        //   const topic = batch.topic;
        //   const partition = batch.partition;
        //   const messages = batch.messages;
        //   const size = batch.messages.length;
        //   const batchId = `${topic}-${partition}-${messages[0].offset}-${messages[size - 1].offset}`;
        //   log.atInfo().log(`Processing batch ${batchId} of ${size} messages`);
        //   const start = dayjs().utc();
        //   for (const message of messages) {
        //     if (isStale()) {
        //       log.atInfo().log(`Batch ${batchId} is stale. Stopping processing.`);
        //       break;
        //     }
        //     if (!isRunning()) {
        //       log.atInfo().log(`Batch ${batchId} is not running. Stopping processing.`);
        //       break;
        //     }
        //     //make sure that queue has no more entities than concurrency limit (running tasks not included)
        //     await onSizeLessThan(concurrency);
        //     await queue.add(async () => onMessage(message, topic, partition));
        //     resolveOffset(message.offset);
        //   }
        //   await commitOffsetsIfNecessary();
        //   const end = dayjs().utc();
        //   log
        //     .atInfo()
        //     .log(
        //       `Processed batch ${batchId} of ${size} messages in ${end.diff(start, "millisecond")}ms`,
        //       JSON.stringify(uncommittedOffsets())
        //     );
        // },
      });

      return metrics;
    },
    close: async () => {
      log.atInfo().log("Closing kafka-rotor");
      await consumer?.disconnect();
      await admin?.disconnect();
      await closeQueue?.();
      await producer?.disconnect();
      if (interval) {
        clearInterval(interval);
      }
      if (metrics) {
        metrics.close();
      }
      log.atInfo().log("Kafka-rotor closed gracefully. 💜");
    },
  };
}

export function getCompressionType() {
  switch (process.env.KAFKA_TOPIC_COMPRESSION) {
    case "gzip":
      return CompressionTypes.GZIP;
    case "snappy":
      return CompressionTypes.Snappy;
    case "lz4":
      log.atWarn().log("lz4 compression is not supported. Disabling producer compression.");
      return undefined;
    case "zstd":
      return CompressionTypes.ZSTD;
    case "none":
      return CompressionTypes.None;
    default:
      return undefined;
  }
}
