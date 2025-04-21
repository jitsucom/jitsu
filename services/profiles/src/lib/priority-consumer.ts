import { ProfileBuilder } from "@jitsu/core-functions";
import { getKafkaCredentialsFromEnv, kafkaAdmin, KafkaCredentials } from "./kafka";
import PQueue from "p-queue";
import { parseNumber } from "juava";
import { KafkaJS, AdminClient } from "@confluentinc/kafka-javascript";
const concurrency = parseNumber(process.env.CONCURRENCY, 10);
const instancesCount = parseNumber(process.env.INSTANCES_COUNT, 10);

interface Consumer {
  start(): Promise<void>;
  close(): Promise<void>;
}

function createPriorityConsumer(
  profileBuilder: ProfileBuilder,
  priorityLevels: number,
  profileTask: (profileId: string) => () => Promise<void>
): Consumer {
  let consumers: Consumer[];
  const kafkaCred = getKafkaCredentialsFromEnv();
  const queue = new PQueue({ concurrency });

  return {
    async start(): Promise<void> {
      for (let i = 0; i < priorityLevels; i++) {
        try {
          kafkaAdmin.createTopic({
            topic: `profile-builder-${profileBuilder.id}-pr${i}`,
            num_partitions: instancesCount,
            replication_factor: 2,
            config: {
              "cleanup.policy": "compact,delete",
              "compression.type": "zstd",
              "retention.ms": "604800000",
              "segment.ms": "86400000",
            },
          });
        } catch (e) {}
        const consumer = new KafkaJS.Kafka({}).consumer({
          "bootstrap.servers": kafkaCred.brokers.join(","),
          "group.id": "profile-builder-" + profileBuilder.id,
        });

        await consumer.connect();
        await consumer.subscribe({ topics: ["test-topic"] });

        consumer.run({
          eachMessage: async ({ topic, partition, message }) => {
            console.log({
              topic,
              partition,
              headers: message.headers,
              offset: message.offset,
              key: message.key?.toString(),
              value: message.value.toString(),
            });
          },
        });
      }
      // Whenever we're done consuming, maybe after user input or a signal:
      await consumer.disconnect();
    },

    async close(): Promise<void> {
      // Simulate closing the consumer
      return new Promise(resolve => {
        setTimeout(() => {
          resolve();
        }, 500);
      });
    },
  };
}
