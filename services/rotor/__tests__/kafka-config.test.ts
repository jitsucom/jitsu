import { expect, test } from "vitest";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import { buildKafkaConfig, kafkaClientLogLevel } from "../src/lib/kafka-config";

const opts = { defaultAppId: "test", brokers: ["localhost:9092"] };

test("client log level falls back to error for missing or unknown values", () => {
  expect(kafkaClientLogLevel(undefined)).toBe(KafkaJS.logLevel.ERROR);
  expect(kafkaClientLogLevel("")).toBe(KafkaJS.logLevel.ERROR);
  expect(kafkaClientLogLevel("not-a-level")).toBe(KafkaJS.logLevel.ERROR);
});

test("client log level accepts configured values regardless of case", () => {
  expect(kafkaClientLogLevel("debug")).toBe(KafkaJS.logLevel.DEBUG);
  expect(kafkaClientLogLevel("DEBUG")).toBe(KafkaJS.logLevel.DEBUG);
  expect(kafkaClientLogLevel("Warn")).toBe(KafkaJS.logLevel.WARN);
  expect(kafkaClientLogLevel("nothing")).toBe(KafkaJS.logLevel.NOTHING);
});

test("librdkafka debug facilities are only set when configured", () => {
  expect(buildKafkaConfig(opts)).not.toHaveProperty("debug");
  expect(buildKafkaConfig(opts, {})).not.toHaveProperty("debug");
  expect(buildKafkaConfig(opts, { debug: "cgrp,fetch,broker" })).toMatchObject({ debug: "cgrp,fetch,broker" });
});

test("defaults keep the client quiet", () => {
  const config = buildKafkaConfig(opts);
  expect(config.kafkaJS.logLevel).toBe(KafkaJS.logLevel.ERROR);
  expect(config.kafkaJS.clientId).toBe("test");
  expect(config.kafkaJS.brokers).toEqual(["localhost:9092"]);
});

test("client logs are routed to a logCreator so librdkafka output is not discarded", () => {
  const config = buildKafkaConfig(opts, { logLevel: "debug" });
  expect(config.kafkaJS.logLevel).toBe(KafkaJS.logLevel.DEBUG);
  expect(typeof config.kafkaJS.logCreator).toBe("function");
  expect(() =>
    config.kafkaJS.logCreator()({
      level: KafkaJS.logLevel.DEBUG,
      log: { fac: "CGRP", message: "rebalance: assigned 3 partition(s)" },
    })
  ).not.toThrow();
});
