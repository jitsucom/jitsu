import { disableService, getLog, randomId, setServerJsonFormat } from "juava";
import {
  connectToKafka,
  destinationMessagesTopic,
  getCredentialsFromEnv,
  rotorConsumerGroupId,
} from "./lib/kafka-config";
import { kafkaRotor } from "./lib/rotor";

import minimist from "minimist";
import { glob } from "glob";
import fs from "fs";
import express from "express";
import { UDFRunHandler } from "./http/udf";
import Prometheus from "prom-client";
import { FunctionsHandler, FunctionsHandlerMulti } from "./http/functions";
import { initMaxMindClient } from "./lib/maxmind";
import { rotorMessageHandler } from "./lib/message-handler";

export const log = getLog("rotor");

disableService("prisma");
disableService("pg");

setServerJsonFormat(process.env.LOG_FORMAT === "json");

const http = express();
http.use(express.json({ limit: "20mb" }));
http.use(express.urlencoded({ limit: "20mb" }));

const rotorHttpPort = process.env.ROTOR_HTTP_PORT || process.env.PORT || 3401;

async function main() {
  process.on("uncaughtException", function (err) {
    // Handle the error safely
    log.atError().withCause(err).log("UncaughtException");
  });

  const args = minimist(process.argv.slice(2));
  if (args._?.[0] === "local") {
    await processLocalFile(args);
  } else if (args._?.[0] === "test-connection") {
    await testConnection(args);
  } else {
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
    Prometheus.collectDefaultMetrics();
    rotor
      .start()
      .then(chMetrics => {
        log.atInfo().log(`Kafka processing started. Listening for topics ${kafkaTopics} with group ${consumerGroupId}`);
        http.get("/health", (req, res) => {
          res.json({ status: "pass" });
        });
        http.get("/metrics", async (req, res) => {
          res.set("Content-Type", Prometheus.register.contentType);
          const result = await Prometheus.register.metrics();
          res.end(result);
        });
        http.post("/udfrun", UDFRunHandler);
        http.post("/func", FunctionsHandler(chMetrics, geoResolver));
        http.post("/func/multi", FunctionsHandlerMulti(chMetrics, geoResolver));
        http.listen(rotorHttpPort, () => {
          log.atInfo().log(`Listening health-checks on port ${rotorHttpPort}`);
        });
      })
      .catch(async e => {
        log.atError().withCause(e).log("Failed to start kafka processing");
        await rotor.close();
        process.exit(1);
      });
    console.log("listening for signals");
    const errorTypes = ["unhandledRejection", "uncaughtException"];
    const signalTraps = ["SIGTERM", "SIGINT", "SIGUSR2"];

    errorTypes.forEach(type => {
      process.once(type, async err => {
        log.atError().withCause(err).log(`process.on ${type}`);
        await rotor.close().finally(() => process.exit(1));
      });
    });

    signalTraps.forEach(type => {
      process.once(type, async () => {
        log.atInfo().log(`Signal ${type} received`);
        await rotor.close().finally(() => process.kill(process.pid, type));
      });
    });
  }
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
