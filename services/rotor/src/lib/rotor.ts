import { getLog } from "juava";
import { connectToKafka, deatLetterTopic, KafkaCredentials } from "@jitsu-internal/console/lib/server/kafka-config";
import Prometheus from "prom-client";
import PQueue from "p-queue";
const concurrency = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY) : 50;

const log = getLog("kafka-rotor");

const maxLocalRetries = 2;

export class NotRetryableError extends Error {
  public doNotRetry: boolean = true;

  constructor(message: string) {
    super(message);
  }
}

async function withRetries(f: () => Promise<void>, opts: { maxRetries?: number; pauseSeconds?: number } = {}) {
  const { maxRetries = 2, pauseSeconds = 5 } = opts;
  while (true) {
    try {
      await f();
      break;
    } catch (e: any) {
      if (e.doNotRetry) {
        throw e;
      }
      log
        .atDebug()
        .withCause(e)
        .log(`Failed to process message. (Local) retries left: ${maxRetries - 1}`);
      if (maxRetries > 1) {
        await new Promise(resolve => setTimeout(resolve, pauseSeconds * 1000));
        return withRetries(f, { maxRetries: maxRetries - 1, pauseSeconds });
      } else {
        throw e;
      }
    }
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

function shouldReturnToQueue(firstProcessed: Date, maxSecondsInQueueAfterFailure: number, error: any) {
  return !error.doNotRetry && Date.now() - firstProcessed.getTime() <= maxSecondsInQueueAfterFailure * 1000;
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
        const firstProcessed = message.headers?.firstProcessed
          ? new Date(message.headers?.firstProcessed.toString())
          : new Date();
        const retries = message.headers?.retries ? parseInt(message.headers?.retries.toString()) : 0;

        try {
          await withRetries(
            async () => {
              if (message.value) {
                await cfg.handle(message.value?.toString());
              }
            },
            { maxRetries: maxLocalRetries }
          );
          messagesProcessed.inc({ topic, partition });
        } catch (e) {
          const returnToQueue = shouldReturnToQueue(firstProcessed, maxSecondsInQueueAfterFailure, e);
          log
            .atError()
            .withCause(e)
            .log(
              `Failed to process message for ${message.key || "(no key set)"} after ${maxLocalRetries} local retries. ${
                returnToQueue ? "Message will be returned to reprocessing" : "Message will be sent to dead-letter queue"
              }: ${message.value}`
            );
          if (!returnToQueue) {
            messagesDeadLettered.inc({ topic });
          } else {
            messagesRequeued.inc({ topic });
          }
          const requeueTopic = returnToQueue ? topic : deatLetterTopic();
          try {
            await producer.send({
              topic: requeueTopic,
              messages: [
                {
                  value: message.value,
                  key: message.key,
                  headers: {
                    firstProcessed: firstProcessed.toISOString(),
                    retries: `${retries + 1}`,
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
          //make sure that queue has no more entities than concurrency
          await onSizeLessThan(1);
          queue.add(async () => onMessage(message, topic, partition));
        },
      });
    },
  };
}
