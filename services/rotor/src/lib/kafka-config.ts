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

const clientLogLevels: Record<string, KafkaJS.logLevel> = {
  nothing: KafkaJS.logLevel.NOTHING,
  error: KafkaJS.logLevel.ERROR,
  warn: KafkaJS.logLevel.WARN,
  info: KafkaJS.logLevel.INFO,
  debug: KafkaJS.logLevel.DEBUG,
};

export function kafkaClientLogLevel(configured?: string): KafkaJS.logLevel {
  return clientLogLevels[(configured || "").toLowerCase()] ?? KafkaJS.logLevel.ERROR;
}

export type KafkaDiagnostics = {
  debug?: string;
  logLevel?: string;
};

export function buildKafkaConfig(
  opts: { defaultAppId: string } & KafkaCredentials,
  diagnostics: KafkaDiagnostics = {}
): any {
  const sasl = opts.sasl
    ? {
        sasl: opts.sasl as any,
      }
    : {};
  return {
    kafkaJS: {
      logLevel: kafkaClientLogLevel(diagnostics.logLevel),
      logCreator: () => (entry: any) =>
        translateLevel(entry.level).log(
          `${entry.log?.fac ? `[${entry.log.fac}] ` : ""}${entry.log?.message ?? JSON.stringify(entry.log)}`
        ),
      clientId: serverEnv.APPLICATION_ID || opts.defaultAppId,
      brokers: typeof opts.brokers === "string" ? (opts.brokers as string).split(",") : opts.brokers,
      ...(opts.ssl ? { ssl: true } : {}),
      ...sasl,
    },
    ...(diagnostics.debug ? { debug: diagnostics.debug } : {}),
    ...opts.ssl,
  };
}

export function connectToKafka(opts: { defaultAppId: string } & KafkaCredentials): KafkaJS.Kafka {
  log.atDebug().log("SASL config", JSON.stringify(opts.sasl));
  return new KafkaJS.Kafka(
    buildKafkaConfig(opts, { debug: serverEnv.KAFKA_DEBUG, logLevel: serverEnv.KAFKA_CLIENT_LOG_LEVEL })
  );
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
