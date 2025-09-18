import { isTruish, parseNumber, requireDefined } from "juava";
import { readFileSync } from "fs";
import { AdminClient } from "@confluentinc/kafka-javascript";

export type KafkaCredentials = {
  brokers: string[];
  ssl?: boolean | Record<string, any>;
  sasl?: {
    mechanism: "scram-sha-256" | "scram-sha-512";
    username: string;
    password: string;
  };
};

export type KafkaSettings = {
  topicPrefix?: string;
  topicReplicationFactor: number;
  topicRetentionMs: number;
  topicSegmentMs: number;
};

function getKafkaCredentialsFromEnv(): KafkaCredentials {
  const ssl = isTruish(process.env.KAFKA_SSL);
  const sslSkipVerify = isTruish(process.env.KAFKA_SSL_SKIP_VERIFY);

  let sslOption: KafkaCredentials["ssl"] = undefined;

  if (ssl) {
    if (sslSkipVerify) {
      // TLS enabled, but server TLS certificate is not verified
      sslOption = {
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      };
    } else if (process.env.KAFKA_SSL_CA) {
      // TLS enabled, server TLS certificate is verified using a custom CA certificate
      sslOption = {
        ca: process.env.KAFKA_SSL_CA,
      };
    } else if (process.env.KAFKA_SSL_CA_FILE) {
      // TLS enabled, server TLS certificate is verified using a custom CA certificate (loaded from a local file)
      sslOption = {
        ca: readFileSync(process.env.KAFKA_SSL_CA_FILE, "utf-8"),
      };
    } else {
      // TLS enabled, no extra configurations
      sslOption = true;
    }
  }

  return {
    brokers: requireDefined(process.env.KAFKA_BOOTSTRAP_SERVERS, "env KAFKA_BOOTSTRAP_SERVERS is required").split(","),
    ssl: sslOption,
    sasl: process.env.KAFKA_SASL ? JSON.parse(process.env.KAFKA_SASL) : undefined,
  };
}

function getKafkaSettingsFromEnv(): KafkaSettings {
  return {
    topicPrefix: process.env.KAFKA_TOPIC_PREFIX,
    topicReplicationFactor: parseNumber(process.env.KAFKA_TOPIC_REPLICATION_FACTOR, 1),
    topicRetentionMs: parseNumber(process.env.KAFKA_TOPIC_RETENTION_HOURS, 48) * 60 * 60 * 1000,
    topicSegmentMs: parseNumber(process.env.KAFKA_TOPIC_SEGMENT_HOURS, 24) * 60 * 60 * 1000,
  };
}

export function topicName(profileBuilderId: string, priority: number): string {
  return `${kafkaSettings.topicPrefix ?? ""}in.id.${profileBuilderId}.m.profiles.t.${priority}`;
}

export const kafkaSettings = getKafkaSettingsFromEnv();
export const kafkaCredentials = getKafkaCredentialsFromEnv();

export const kafkaAdmin = AdminClient.create({
  "bootstrap.servers": kafkaCredentials.brokers.join(","),
  "client.id": "profile-builder-" + process.env.INSTANCE_INDEX,
});
