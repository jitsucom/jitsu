import { getLog } from "juava";
import {
  connectToKafka,
  deatLetterTopic,
  KafkaCredentials,
  retryTopic,
} from "@jitsu-internal/console/lib/server/kafka-config";
import Prometheus from "prom-client";
import PQueue from "p-queue";
const concurrency = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY) : 50;
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

const log = getLog("kafka-rotor");

const RETRY_TIME_HEADER = "retry_time";
const RETRY_COUNT_HEADER = "retries";
const ORIGINAL_TOPIC_HEADER = "original_topic";

const MESSAGES_RETRY_COUNT = process.env.MESSAGES_RETRY_COUNT ? parseInt(process.env.MESSAGES_RETRY_COUNT) : 3;
// MESSAGES_RETRY_BACKOFF_BASE defines base for exponential backoff in minutes.
// For example, if MESSAGES_RETRY_COUNT is 3 and base is 5, then retry delays will be 5, 25, 125 minutes.
const MESSAGES_RETRY_BACKOFF_BASE = process.env.MESSAGES_RETRY_BACKOFF_BASE
  ? parseInt(process.env.MESSAGES_RETRY_BACKOFF_BASE)
  : 2;
// MESSAGES_RETRY_BACKOFF_MAX_DELAY defines maximum possible retry delay in minutes. Default: 1440 minutes = 24 hours
const MESSAGES_RETRY_BACKOFF_MAX_DELAY = process.env.MESSAGES_RETRY_BACKOFF_MAX_DELAY
  ? parseInt(process.env.MESSAGES_RETRY_BACKOFF_MAX_DELAY)
  : 1440;

function RetryBackOffTime(attempt: number) {
  const backOffDelayMin = Math.min(Math.pow(MESSAGES_RETRY_BACKOFF_BASE, attempt), MESSAGES_RETRY_BACKOFF_MAX_DELAY);
  return dayjs().add(backOffDelayMin, "minute").utc().toISOString();
}

export class NotRetryableError extends Error {
  public doNotRetry: boolean = true;

  constructor(message: string) {
    super(message);
  }
}

export type KafkaRotorConfig = {
  credentials: KafkaCredentials;
  consumerGroupId: string;
  kafkaTopics: string[];
  kafkaClientId?: string;
  maxSecondsInQueueAfterFailure?: number;
  handle: (message: string) => Promise<void>;
};

export type KafkaRotor = {
  start: () => Promise<void>;
};

function shouldRetry(retries: number, error: any) {
  return !error.doNotRetry && retries < MESSAGES_RETRY_COUNT;
}

export function kafkaRotor(cfg: KafkaRotorConfig): KafkaRotor {
  const { kafkaTopics, kafkaClientId = "kafka-rotor", maxSecondsInQueueAfterFailure = 3600 } = cfg;
  return {
    start: async () => {
      const kafka = connectToKafka({ defaultAppId: kafkaClientId, ...cfg.credentials });
      const consumer = kafka.consumer({
        groupId: cfg.consumerGroupId,
        allowAutoTopicCreation: false,
        sessionTimeout: 120000,
      });
      await consumer.connect();
      await consumer.subscribe({ topics: kafkaTopics, fromBeginning: true });

      const producer = kafka.producer({ allowAutoTopicCreation: false });
      await producer.connect();

      const admin = kafka.admin();

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
      const interval = setInterval(async () => {
        try {
          for (const topic of kafkaTopics) {
            const watermarks = await admin.fetchTopicOffsets(topic);
            for (const o of watermarks) {
              topicOffsets.set({ topic: topic, partition: o.partition, offset: "high" }, parseInt(o.high));
              topicOffsets.set({ topic: topic, partition: o.partition, offset: "low" }, parseInt(o.low));
            }
          }
          const offsets = await admin.fetchOffsets({ groupId: cfg.consumerGroupId, topics: kafkaTopics });
          for (const o of offsets) {
            for (const p of o.partitions) {
              topicOffsets.set({ topic: o.topic, partition: p.partition, offset: "offset" }, parseInt(p.offset));
            }
          }
        } catch (e) {
          log.atError().withCause(e).log("Failed to commit offsets");
        }
      }, 60000);

      async function onMessage(message: any, topic: string, partition: number) {
        messagesConsumed.inc({ topic, partition });
        const headers = message.headers || {};
        const retries = headers[RETRY_COUNT_HEADER] ? parseInt(headers[RETRY_COUNT_HEADER].toString()) : 0;

        try {
          if (message.value) {
            await cfg.handle(message.value?.toString());
            messagesProcessed.inc({ topic, partition });
          }
        } catch (e) {
          const retry = shouldRetry(retries, e);
          log
            .atError()
            .withCause(e)
            .log(
              `Failed to process message for ${message.key || "(no key set)"} after ${retries} local retries. ${
                retry ? "Message will be returned to reprocessing" : "Message will be sent to dead-letter queue"
              }: ${message.value}`
            );
          if (!retry) {
            messagesDeadLettered.inc({ topic });
          } else {
            messagesRequeued.inc({ topic });
          }
          const requeueTopic = retry ? retryTopic() : deatLetterTopic();
          try {
            await producer.send({
              topic: requeueTopic,
              messages: [
                {
                  value: message.value,
                  key: message.key,
                  headers: {
                    [RETRY_COUNT_HEADER]: `${retries}`,
                    [ORIGINAL_TOPIC_HEADER]: topic,
                    [RETRY_TIME_HEADER]: RetryBackOffTime(retries + 1),
                  },
                },
              ],
            });
          } catch (e) {
            log.atDebug().withCause(e).log(`Failed to put message to ${topic}: ${message.value}`);
          }
        }
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

      await consumer.run({
        eachMessage: async ({ message, topic, partition }) => {
          //make sure that queue has no more entities than concurrency limit (running tasks not included)
          await onSizeLessThan(concurrency);
          queue.add(async () => onMessage(message, topic, partition));
        },
      });
    },
  };
}
