import { getLog } from "juava";
import { connectToKafka, KafkaCredentials } from "@jitsu-internal/console/lib/server/kafka-config";
import Prometheus from "prom-client";

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
  kafkaTopic?: string;
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
  const { kafkaTopic = "incoming-queue", kafkaClientId = "kafka-rotor", maxSecondsInQueueAfterFailure = 3600 } = cfg;
  return {
    start: async () => {
      const kafka = connectToKafka({ defaultAppId: kafkaClientId, ...cfg.credentials });
      const consumer = kafka.consumer({ groupId: cfg.consumerGroupId, allowAutoTopicCreation: false });
      await consumer.connect();
      await consumer.subscribe({ topic: kafkaTopic, fromBeginning: true });

      const producer = kafka.producer({ allowAutoTopicCreation: false });
      await producer.connect();

      const admin = kafka.admin();

      const topicOffsets = new Prometheus.Gauge({
        name: "rotor_topic_offsets",
        help: "topic offsets",
        // add `as const` here to enforce label names
        labelNames: ["partition", "offset"] as const,
      });
      const interval = setInterval(async () => {
        try {
          const watermarks = await admin.fetchTopicOffsets(kafkaTopic);
          for (const o of watermarks) {
            topicOffsets.set({ partition: o.partition, offset: "high" }, parseInt(o.high));
            topicOffsets.set({ partition: o.partition, offset: "low" }, parseInt(o.low));
          }
          const offsets = await admin.fetchOffsets({ groupId: cfg.consumerGroupId, topics: [kafkaTopic] });
          for (const o of offsets) {
            for (const p of o.partitions) {
              topicOffsets.set({ partition: p.partition, offset: "offset" }, parseInt(p.offset));
            }
          }
        } catch (e) {
          log.atError().withCause(e).log("Failed to commit offsets");
        }
      }, 60000);

      await consumer.run({
        autoCommit: true,
        partitionsConsumedConcurrently: 4,
        eachMessage: async ({ message }) => {
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
          } catch (e) {
            const returnToQueue = shouldReturnToQueue(firstProcessed, maxSecondsInQueueAfterFailure, e);
            log
              .atError()
              .withCause(e)
              .log(
                `Failed to process message for ${
                  message.key || "(no key set)"
                } after ${maxLocalRetries} local retries. ${
                  returnToQueue
                    ? "Message will be returned to reprocessing"
                    : "Message will be sent to dead-letter queue"
                }: ${message.value}`
              );
            const topic = returnToQueue ? kafkaTopic : kafkaTopic + "-dead-letter";
            try {
              await producer.send({
                topic,
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
        },
      });
    },
  };
}
