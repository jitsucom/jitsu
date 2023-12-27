import { disableService, getLog, randomId, setServerJsonFormat } from "juava";
import {
  connectToKafka,
  destinationMessagesTopic,
  getCredentialsFromEnv,
  rotorConsumerGroupId,
} from "./lib/kafka-config";
import { kafkaRotor } from "./lib/rotor";
import { mongodb } from "@jitsu/core-functions";
import minimist from "minimist";
import { glob } from "glob";
import fs from "fs";
import express from "express";
import { UDFRunHandler } from "./http/udf";
import Prometheus from "prom-client";
import { FunctionsHandler, FunctionsHandlerMulti } from "./http/functions";
import { initMaxMindClient, GeoResolver } from "./lib/maxmind";
import { rotorMessageHandler } from "./lib/message-handler";
import { redis } from "@jitsu-internal/console/lib/server/redis";
import { redisLogger } from "./lib/redis-logger";
import { createMetrics, Metrics } from "./lib/metrics";
import { isTruish } from "@jitsu-internal/console/lib/shared/chores";
import { pgConfigStore } from "./lib/pg-config-store";

export const log = getLog("rotor");

disableService("prisma");
disableService("pg");

setServerJsonFormat(process.env.LOG_FORMAT === "json");

const http = express();
http.use(express.json({ limit: "20mb" }));
http.use(express.urlencoded({ limit: "20mb" }));

const rotorHttpPort = process.env.ROTOR_HTTP_PORT || process.env.PORT || 3401;

async function main() {
  const errorTypes = ["unhandledRejection", "uncaughtException"];
  const signalTraps = ["SIGTERM", "SIGINT", "SIGUSR2"];

  errorTypes.forEach(type => {
    process.once(type, err => {
      log.atError().withCause(err).log(`process.on ${type}`);
      process.exit(1);
    });
  });

  signalTraps.forEach(type => {
    process.once(type, () => {
      log.atInfo().log(`Signal ${type} received`);
      process.kill(process.pid, type);
    });
  });

  process.on("exit", code => {
    log.atInfo().log(`Process exited with code ${code}`);
  });

  const args = minimist(process.argv.slice(2));
  if (args._?.[0] === "local") {
    await processLocalFile(args);
  } else if (args._?.[0] === "test-connection") {
    await testConnection(args);
  } else if (process.env.KAFKA_BOOTSTRAP_SERVERS && !isTruish(process.env.HTTP_ONLY)) {
    Prometheus.collectDefaultMetrics();
    await mongodb.waitInit();
    await redis.waitInit();
    await redisLogger.waitInit();
    const store = await pgConfigStore.get();
    if (!store.enabled) {
      log.atError().log("Postgres is not configured. Rotor will not work");
      process.exit(1);
    }
    //kafka consumer mode
    const kafkaTopics = [destinationMessagesTopic()];
    const consumerGroupId = rotorConsumerGroupId();
    const geoResolver = await initMaxMindClient(process.env.MAXMIND_LICENSE_KEY || "");
    const rotor = kafkaRotor({
      credentials: getCredentialsFromEnv(),
      kafkaTopics: kafkaTopics,
      consumerGroupId,
      geoResolver,
      handle: rotorMessageHandler,
    });
    log.atInfo().log("Starting kafka processing");
    rotor
      .start()
      .then(chMetrics => {
        log.atInfo().log(`Kafka processing started. Listening for topics ${kafkaTopics} with group ${consumerGroupId}`);
        initHTTP(chMetrics, geoResolver);
      })
      .catch(async e => {
        log.atError().withCause(e).log("Failed to start kafka processing");
        await rotor.close();
        process.exit(1);
      });

    process.on("beforeExit", async () => {
      await rotor.close();
    });
  } else {
    Prometheus.collectDefaultMetrics();
    await mongodb.waitInit();
    await redis.waitInit();
    await redisLogger.waitInit();
    const store = await pgConfigStore.get();
    if (!store.enabled) {
      log.atError().log("Postgres is not configured. Rotor will not work");
      process.exit(1);
    }
    const geoResolver = await initMaxMindClient(process.env.MAXMIND_LICENSE_KEY || "");
    const chMetrics = createMetrics();
    initHTTP(chMetrics, geoResolver);
  }
}

function initHTTP(metrics: Metrics, geoResolver: GeoResolver) {
  http.get("/health", (req, res) => {
    res.json({
      status: "pass",
      configStore: {
        enabled: pgConfigStore.getCurrent()?.enabled || "loading",
        status: pgConfigStore.status(),
        lastUpdated: pgConfigStore.lastRefresh(),
      },
    });
  });
  http.get("/metrics", async (req, res) => {
    res.set("Content-Type", Prometheus.register.contentType);
    const result = await Prometheus.register.metrics();
    res.end(result);
  });
  http.post("/udfrun", UDFRunHandler);
  http.post("/func", FunctionsHandler(metrics, geoResolver));
  http.post("/func/multi", FunctionsHandlerMulti(metrics, geoResolver));
  http.listen(rotorHttpPort, () => {
    log.atInfo().log(`Listening health-checks on port ${rotorHttpPort}`);
  });
}

async function processLocalFile(args: minimist.ParsedArgs) {
  if (args["f"]) {
    glob(args["f"], async (err, files) => {
      if (err) {
        log.atError().withCause(err).log(`Failed to read files ${args["f"]}`);
        process.exit(1);
      }
      for (const file of files) {
        const content = JSON.parse(fs.readFileSync(file, "utf8"));
        const events = Array.isArray(content) ? content : [content];
        log.atInfo().log(`Reading file ${file}. Events: ${events.length}`);
        for (const event of events) {
          try {
            await rotorMessageHandler(JSON.stringify(event));
          } catch (e) {
            log
              .atError()
              .withCause(e)
              .log(`Failed to process event from ${file}: ${JSON.stringify(event)}`);
          }
        }
      }
    });
  } else if (args["j"]) {
    const content = JSON.parse(args["j"]);
    const events = Array.isArray(content) ? content : [content];
    for (const event of events) {
      try {
        await rotorMessageHandler(JSON.stringify(event));
      } catch (e) {
        log
          .atError()
          .withCause(e)
          .log(`Failed to process event: ${JSON.stringify(event)}`);
      }
    }
  }
}

async function testConnection(args: minimist.ParsedArgs) {
  const credentials = getCredentialsFromEnv();
  const kafka = connectToKafka({ ...credentials, defaultAppId: "connection-tester" });
  const producer = kafka.producer();
  await producer.connect();
  const topic = "connection-tester" + randomId(5);
  const testMessage = { value: "test" };
  await producer.send({ topic, messages: [testMessage] });
  await producer.disconnect();

  const consumer = kafka.consumer({ groupId: topic });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  const message = (await new Promise(resolve => {
    consumer.run({
      eachMessage: async ({ message }) => {
        resolve(message);
      },
    });
  })) as any;
  log.atInfo().log(`Received message: ${message.value}`);
  await consumer.disconnect();
}

main();

export {};
