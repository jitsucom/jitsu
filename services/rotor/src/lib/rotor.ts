import { getLog, requireDefined, parseNumber } from "juava";
import { connectToKafka, deatLetterTopic, KafkaCredentials, retryTopic } from "./kafka-config";
import Prometheus from "prom-client";
import PQueue from "p-queue";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import { getRetryPolicy, retryBackOffTime, retryLogMessage } from "./retries";
import { createMetrics, Metrics } from "./metrics";
import { FuncChainFilter, FuncChainResult } from "./functions-chain";
import type { Admin, Consumer, Producer, KafkaMessage } from "kafkajs";
import { CompressionTypes } from "kafkajs";
import { functionFilter, MessageHandlerContext } from "./message-handler";
import { connectionsStore, functionsStore } from "./entity-store";

const log = getLog("kafka-rotor");

const RETRY_TIME_HEADER = "retry_time";
const RETRY_COUNT_HEADER = "retries";
const ERROR_HEADER = "error";
const ORIGINAL_TOPIC_HEADER = "original_topic";
const FUNCTION_ID_HEADER = "function_id";
export const CONNECTION_IDS_HEADER = "connection_ids";

const concurrency = parseNumber(process.env.CONCURRENCY, 10);
const fetchTimeoutMs = parseNumber(process.env.FETCH_TIMEOUT_MS, 2000);

export type KafkaRotorConfig = {
  credentials: KafkaCredentials;
  consumerGroupId: string;
  kafkaTopics: string[];
  kafkaClientId?: string;
  rotorContext: Omit<MessageHandlerContext, "connectionStore" | "functionsStore" | "metrics">;
  handle: (
    message: string,
    rotorContext: MessageHandlerContext,
    runFuncs: FuncChainFilter,
    headers?,
    retriesEnabled?: boolean,
    retries?: number,
    fetchTimeoutMs?: number
  ) => Promise<FuncChainResult | undefined>;
};

export type KafkaRotor = {
  start: () => Promise<Metrics>;
  close: () => Promise<void>;
};

export function kafkaRotor(cfg: KafkaRotorConfig): KafkaRotor {
  const { kafkaTopics, consumerGroupId, rotorContext, handle, kafkaClientId = "kafka-rotor" } = cfg;
  let consumer: Consumer;
  let producer: Producer;
  let admin: Admin;
  let closeQueue: () => Promise<void>;
  let interval: any;
  let metrics: Metrics;
  return {
    start: async () => {
      const kafka = connectToKafka({ defaultAppId: kafkaClientId, ...cfg.credentials });
      consumer = kafka.consumer({
        groupId: consumerGroupId,
        allowAutoTopicCreation: false,
        sessionTimeout: 10000,
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
              ...rotorContext,
              connectionStore: requireDefined(connectionsStore.getCurrent(), "Connection store is not initialized"),
              functionsStore: requireDefined(functionsStore.getCurrent(), "Functions store is not initialized"),
              metrics,
            },
            functionFilter(retriedFunctionId),
            {
              ...headers,
              [CONNECTION_IDS_HEADER]: connectionId,
            },
            true,
            retries,
            fetchTimeoutMs
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
                        [ERROR_HEADER]: e.message?.substring(0, 1024) || "unknown error",
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
        partitionsConsumedConcurrently: 8,
        eachMessage: async ({ message, topic, partition }) => {
          //make sure that queue has no more entities than concurrency limit (running tasks not included)
          await onSizeLessThan(concurrency);
          queue.add(async () => onMessage(message, topic, partition));
        },
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
