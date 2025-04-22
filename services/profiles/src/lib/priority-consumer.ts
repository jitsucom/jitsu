import { ProfileBuilder } from "@jitsu/core-functions";
import { kafkaAdmin, kafkaCredentials, topicName } from "./kafka";
import PQueue from "p-queue";
import { getLog, parseNumber } from "juava";
import { KafkaJS } from "@confluentinc/kafka-javascript";
const concurrency = parseNumber(process.env.CONCURRENCY, 10);
const instancesCount = parseNumber(process.env.INSTANCES_COUNT, 10);

const log = getLog("priority-consumer");

interface PriorityConsumer {
  start(): Promise<void>;
  close(): Promise<void>;
}

type ProfileId = string;
type RateLimitWindow = {
  activated: boolean;
};

const rateLimitWindows: Record<ProfileId, RateLimitWindow> = {};

export function createPriorityConsumer(
  profileBuilder: ProfileBuilder,
  priorityLevels: number,
  profileTask: (profileId: string) => () => Promise<void>
): PriorityConsumer {
  let consumers: KafkaJS.Consumer[];
  const queue = new PQueue({ concurrency });

  const onSizeLessThan = async (limit: number) => {
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

  return {
    async start(): Promise<void> {
      for (let i = 0; i < priorityLevels; i++) {
        const sizeCap = concurrency * (1 - i / 10);
        const topic = topicName(profileBuilder.id, i);
        try {
          kafkaAdmin.createTopic({
            topic,
            num_partitions: instancesCount,
            replication_factor: 2,
            config: {
              "cleanup.policy": "compact,delete",
              "retention.ms": "604800000",
              "segment.ms": "86400000",
            },
          });
        } catch (e) {}

        const consumer = new KafkaJS.Kafka({}).consumer({
          "bootstrap.servers": kafkaCredentials.brokers.join(","),
          "group.id": "profile-builder-" + profileBuilder.id,
        });

        await consumer.connect();
        await consumer.subscribe({ topics: [topic] });

        consumer.run({
          eachMessage: async ({ message }) => {
            const profileId = message.key?.toString();
            if (!profileId) {
              log.atError().log("Message without key");
              return;
            }
            await onSizeLessThan(sizeCap);
            queue
              .add(
                async () => {
                  await rateLimitedExecution(profileId, profileTask(profileId), 1000 * 30);
                },
                { priority: priorityLevels - i }
              )
              .catch(e => {
                log.atError().withCause(e).log("Failed to process message");
              });
          },
        });

        consumers.push(consumer);
      }
    },

    async close(): Promise<void> {
      for (const consumer of consumers) {
        await consumer.disconnect();
      }
      await closeQueue();
    },
  };
}

async function rateLimitedExecution(
  key: string,
  task: () => Promise<void>,
  intervalMs: number = 1000 * 30
): Promise<void> {
  const rateLimitWindow = rateLimitWindows[key];
  // First event for key or event after a long pause (more than intervalMs)
  if (!rateLimitWindow) {
    const newRateLimitWindow: RateLimitWindow = {
      activated: false,
    };
    rateLimitWindows[key] = newRateLimitWindow;
    let timeout: NodeJS.Timeout;
    // The newRateLimitWindow collapses all events received for a key in the last intervalMs into the one
    // timer will execute the one in that case
    timeout = setTimeout(() => {
      if (!newRateLimitWindow.activated) {
        // No events received in the last intervalMs. Removing the rate limit window
        log.atInfo().log(`Deactivating rate limit window for ${key}`);
        clearTimeout(timeout);
        delete rateLimitWindows[key];
      } else {
        // reset the timer and newRateLimitWindow state
        timeout.refresh();
        newRateLimitWindow.activated = false;
        // execute the task
        task();
      }
    }, intervalMs);
    // First event for key or event after a long pause (more than intervalMs). Execute the task right away
    await task();
  } else if (!rateLimitWindow.activated) {
    // Event received for key during the intervalMs. Activate the rate limit window
    // Task will be executed after interval ends
    log.atInfo().log(`Activating rate limit window for ${key}`);
    rateLimitWindow.activated = true;
  } else {
    log.atInfo().log(`Rate limit window for ${key} is already activated`);
  }
}
