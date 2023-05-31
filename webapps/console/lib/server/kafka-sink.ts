import { getSingleton } from "juava";
import { connectToKafka, getCredentialsFromEnv } from "./kafka-config";

export type KafkaSink = {
  send(
    topic: { name: string },
    message: { body: Record<string, any>; key?: string; headers?: Record<string, string> }
  ): Promise<void>;
};

export const kafkaSink = getSingleton<KafkaSink>("kafka", createKafka);

async function createKafka(): Promise<KafkaSink> {
  const kafka = connectToKafka({ defaultAppId: "jitsu-sink", ...getCredentialsFromEnv() });
  const producer = kafka.producer();
  await producer.connect();
  return {
    send: async (topic, { body, key, headers }) => {
      await producer.send({
        topic: topic.name,
        messages: [{ value: JSON.stringify(body), key, headers }],
      });
    },
  };
}
