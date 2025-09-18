import { KafkaJS, GlobalConfig } from "@confluentinc/kafka-javascript";

import { isTruish, LogMessageBuilder, requireDefined, randomId, getLog } from "juava";
import JSON5 from "json5";
const log = getLog("kafka");

function translateLevel(l: KafkaJS.logLevel): LogMessageBuilder {
  switch (l) {
    case KafkaJS.logLevel.ERROR:
      return log.atError();
    case KafkaJS.logLevel.WARN:
      return log.atWarn();
    case KafkaJS.logLevel.INFO:
      return log.atDebug();
    case KafkaJS.logLevel.DEBUG:
      return log.atDebug();
    default:
      return log.atInfo();
  }
}

export type KafkaCredentials = {
  brokers: KafkaJS.KafkaConfig["brokers"];
  ssl?: GlobalConfig;
  sasl?: KafkaJS.KafkaConfig["sasl"];
};

export function getCredentialsFromEnv(): KafkaCredentials {
  const ssl = isTruish(process.env.KAFKA_SSL);
  const sslSkipVerify = isTruish(process.env.KAFKA_SSL_SKIP_VERIFY);
  let sslOption: KafkaCredentials["ssl"] = undefined;

  if (ssl) {
    sslOption = {
      "security.protocol": process.env.KAFKA_SASL ? "sasl_ssl" : "ssl",
    };
    if (sslSkipVerify) {
      // TLS enabled, but server TLS certificate is not verified
      sslOption["ssl.endpoint.identification.algorithm"] = "none";
      sslOption["enable.ssl.certificate.verification"] = false;
    } else if (process.env.KAFKA_SSL_CA) {
      // TLS enabled, server TLS certificate is verified using a custom CA certificate
      sslOption["ssl.ca.pem"] = process.env.KAFKA_SSL_CA;
    } else if (process.env.KAFKA_SSL_CA_FILE) {
      // TLS enabled, server TLS certificate is verified using a custom CA certificate (loaded from a local file)
      sslOption["ssl.ca.location"] = process.env.KAFKA_SSL_CA_FILE;
    }
  }

  return {
    brokers: requireDefined(process.env.KAFKA_BOOTSTRAP_SERVERS, "env KAFKA_BOOTSTRAP_SERVERS is required").split(","),
    ssl: sslOption,
    sasl: process.env.KAFKA_SASL ? JSON5.parse(process.env.KAFKA_SASL) : undefined,
  };
}

export function connectToKafka(opts: { defaultAppId: string } & KafkaCredentials): KafkaJS.Kafka {
  const sasl = opts.sasl
    ? {
        sasl: opts.sasl as any,
      }
    : {};
  log.atDebug().log("SASL config", JSON.stringify(opts.sasl));
  return new KafkaJS.Kafka({
    kafkaJS: {
      logLevel: KafkaJS.logLevel.ERROR,
      // logCreator: logLevel => log => {
      //   translateLevel(logLevel).log(
      //     `${log.namespace ? `${log.namespace} # ` : ""}${JSON.stringify(omit(log.log, "timestamp", "logger"))}`
      //   );
      // },
      clientId: process.env.APPLICATION_ID || opts.defaultAppId,
      brokers: typeof opts.brokers === "string" ? (opts.brokers as string).split(",") : opts.brokers,
      ...(opts.ssl ? { ssl: true } : {}),
      ...sasl,
    },
    ...opts.ssl,
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
