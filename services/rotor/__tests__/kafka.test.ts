import { getLog } from "juava";
import { connectToKafka } from "../src/lib/kafka-config";

import "@sensejs/kafkajs-zstd-support";
import { test } from "@jest/globals";

const log = getLog("kafka-test");
test.skip("Kafka Test", async () => {
  const kafka = connectToKafka({ defaultAppId: "test", brokers: "localhost:9092" });
  const consumer = kafka.consumer({
    groupId: "test",
    allowAutoTopicCreation: true,
    sessionTimeout: 10000,
  });
  await consumer.connect();
  await consumer.subscribe({ topics: ["autocommit-test"], fromBeginning: true });

  const producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();

  for (let i = 0; i < 200; i++) {
    producer.send({
      topic: "autocommit-test",
      messages: [
        {
          value: `message #${i}`,
        },
      ],
    });
  }

  await consumer.run({
    autoCommitInterval: 10000,
    autoCommit: true,
    partitionsConsumedConcurrently: 8,
    eachMessage: async ({ topic, partition, message }) => {
      log.atInfo().log(`${topic}:${partition}: ${message.offset} => ${message.value?.toString()}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    },
  });
  setTimeout(() => {
    consumer.disconnect();
  }, 15000);

  await new Promise(resolve => setTimeout(resolve, 20000));
}, 40000);
