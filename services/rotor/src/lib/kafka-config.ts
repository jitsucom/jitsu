import { KafkaJS, GlobalConfig } from "@confluentinc/kafka-javascript";

import { isTruish, LogMessageBuilder, requireDefined, randomId, getLog } from "juava";
import JSON5 from "json5";
import { getServerEnv } from "../serverEnv";
const log = getLog("kafka");

const serverEnv = getServerEnv();

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
  const ssl = isTruish(serverEnv.KAFKA_SSL);
  const sslSkipVerify = isTruish(serverEnv.KAFKA_SSL_SKIP_VERIFY);
  let sslOption: KafkaCredentials["ssl"] = undefined;

  if (ssl) {
    sslOption = {
      "security.protocol": serverEnv.KAFKA_SASL ? "sasl_ssl" : "ssl",
    };
    if (sslSkipVerify) {
      // TLS enabled, but server TLS certificate is not verified
      sslOption["ssl.endpoint.identification.algorithm"] = "none";
      sslOption["enable.ssl.certificate.verification"] = false;
    } else if (serverEnv.KAFKA_SSL_CA) {
      // TLS enabled, server TLS certificate is verified using a custom CA certificate
      sslOption["ssl.ca.pem"] = serverEnv.KAFKA_SSL_CA;
    } else if (serverEnv.KAFKA_SSL_CA_FILE) {
      // TLS enabled, server TLS certificate is verified using a custom CA certificate (loaded from a local file)
      sslOption["ssl.ca.location"] = serverEnv.KAFKA_SSL_CA_FILE;
    }
  }

  return {
    brokers: requireDefined(serverEnv.KAFKA_BOOTSTRAP_SERVERS, "env KAFKA_BOOTSTRAP_SERVERS is required").split(","),
    ssl: sslOption,
    sasl: serverEnv.KAFKA_SASL ? JSON5.parse(serverEnv.KAFKA_SASL) : undefined,
  };
}

export function connectToKafka(opts: { defaultAppId: string } & KafkaCredentials): KafkaJS.Kafka {
  const sasl = opts.sasl
    ? {
        sasl: opts.sasl as any,
      }
    : {};
  // never the password: the user and the mechanism are enough to see what is configured
  log.atDebug().log("SASL config", { mechanism: opts.sasl?.mechanism, username: (opts.sasl as any)?.username });
  return new KafkaJS.Kafka({
    kafkaJS: {
      logLevel: KafkaJS.logLevel.ERROR,
      // logCreator: logLevel => log => {
      //   translateLevel(logLevel).log(
      //     `${log.namespace ? `${log.namespace} # ` : ""}${JSON.stringify(omit(log.log, "timestamp", "logger"))}`
      //   );
      // },
      clientId: serverEnv.APPLICATION_ID || opts.defaultAppId,
      brokers: typeof opts.brokers === "string" ? (opts.brokers as string).split(",") : opts.brokers,
      ...(opts.ssl ? { ssl: true } : {}),
      ...sasl,
    },
    ...opts.ssl,
  });
}

export function destinationMessagesTopic(): string {
  return serverEnv.KAFKA_DESTINATIONS_TOPIC_NAME || "destination-messages";
}

export function deatLetterTopic(): string {
  return serverEnv.KAFKA_DESTINATIONS_DEAD_LETTER_TOPIC_NAME || "destination-messages-dead-letter";
}

export function retryTopic(): string {
  return serverEnv.KAFKA_DESTINATIONS_RETRY_TOPIC_NAME || "destination-messages-retry";
}

export function destinationMessagesTopicMultiThreaded(): string {
  return serverEnv.KAFKA_DESTINATIONS_MT_TOPIC_NAME || "destination-messages-mt";
}

export function rotorConsumerGroupId(): string {
  return serverEnv.KAFKA_CONSUMER_GROUP_ID !== undefined
    ? serverEnv.KAFKA_CONSUMER_GROUP_ID.replace("$random", randomId(5))
    : "rotor";
}
