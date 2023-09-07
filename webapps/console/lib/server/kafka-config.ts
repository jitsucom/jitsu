import { Kafka, logLevel, CompressionCodecs, CompressionTypes } from "kafkajs";
import SnappyCodec from "kafkajs-snappy";
import "@sensejs/kafkajs-zstd-support";

import { LogMessageBuilder, requireDefined, randomId } from "juava";
import JSON5 from "json5";
import { getServerLog } from "./log";

CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;

const log = getServerLog("kafka");

function translateLevel(l: logLevel): LogMessageBuilder {
  switch (l) {
    case logLevel.ERROR:
      return log.atError();
    case logLevel.WARN:
      return log.atWarn();
    case logLevel.INFO:
      return log.atDebug();
    case logLevel.DEBUG:
      return log.atDebug();
    default:
      return log.atInfo();
  }
}

export type KafkaCredentials = {
  brokers: string[] | string;
  ssl?: boolean;
  sasl?: {
    mechanism: "scram-sha-256" | "scram-sha-512";
    username: string;
    password: string;
  };
};

export function getCredentialsFromEnv(): KafkaCredentials {
  return {
    brokers: requireDefined(process.env.KAFKA_BOOTSTRAP_SERVERS, "env KAFKA_BOOTSTRAP_SERVERS is required").split(","),
    ssl: process.env.KAFKA_SSL === "true" || process.env.KAFKA_SSL === "1",
    sasl: process.env.KAFKA_SASL ? JSON5.parse(process.env.KAFKA_SASL) : undefined,
  };
}

export function connectToKafka(opts: { defaultAppId: string } & KafkaCredentials): Kafka {
  const sasl = opts.sasl
    ? {
        sasl: opts.sasl as any,
      }
    : {};
  log.atDebug().log("SASL config", JSON.stringify(opts.sasl));
  return new Kafka({
    logLevel: logLevel.ERROR,
    // logCreator: logLevel => log => {
    //   translateLevel(logLevel).log(
    //     `${log.namespace ? `${log.namespace} # ` : ""}${JSON.stringify(omit(log.log, "timestamp", "logger"))}`
    //   );
    // },
    clientId: process.env.APPLICATION_ID || opts.defaultAppId,
    brokers: typeof opts.brokers === "string" ? opts.brokers.split(",") : opts.brokers,
    ssl: opts.ssl
      ? {
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        }
      : undefined,

    ...sasl,
  });
}

export function destinationMessagesTopic(): string {
  return process.env.KAFKA_DESTINATIONS_TOPIC_NAME || "destination-messages";
}

export function deatLetterTopic(): string {
  return process.env.KAFKA_DESTINATIONS_DEAD_LETTER_TOPIC_NAME || "destination-messages-dead-letter";
}

export function retryTopic(): string {
  return process.env.KAFKA_DESTINATIONS_RETRY_TOPIC_NAME || "destination-messages-retry";
}

export function destinationMessagesTopicMultiThreaded(): string {
  return process.env.KAFKA_DESTINATIONS_MT_TOPIC_NAME || "destination-messages-mt";
}

export function rotorConsumerGroupId(): string {
  return process.env.KAFKA_CONSUMER_GROUP_ID !== undefined
    ? process.env.KAFKA_CONSUMER_GROUP_ID.replace("$random", randomId(5))
    : "rotor";
}
