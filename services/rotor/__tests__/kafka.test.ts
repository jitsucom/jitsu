import { getLog } from "juava";
import { connectToKafka } from "../src/lib/kafka-config";
import { test } from "@jest/globals";

const log = getLog("kafka-test");
test.skip("Kafka Test", async () => {
  const kafka = connectToKafka({ defaultAppId: "test", brokers: ["localhost:9092"] });
  const consumer = kafka.consumer({
    kafkaJS: {
      groupId: "test",
      allowAutoTopicCreation: true,
      sessionTimeout: 10000,
      autoCommitInterval: 10000,
      autoCommit: true,
      fromBeginning: true,
    },
  });
  await consumer.connect();
  await consumer.subscribe({ topics: ["autocommit-test"] });

  const producer = kafka.producer({ kafkaJS: { allowAutoTopicCreation: false } });
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
