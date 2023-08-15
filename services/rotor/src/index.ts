import { disableService, getLog, newError, randomId, requireDefined, setServerJsonFormat } from "juava";

disableService("prisma");
disableService("pg");

import {
  connectToKafka,
  destinationMessagesTopic,
  getCredentialsFromEnv,
  rotorConsumerGroupId,
} from "@jitsu-internal/console/lib/server/kafka-config";

import { IngestMessage } from "@jitsu/protocols/async-request";
import { kafkaRotor } from "./lib/rotor";
import { fastStore } from "@jitsu-internal/console/lib/server/fast-store";

import minimist from "minimist";
import { glob } from "glob";
import fs from "fs";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { createRedisLogger, Func, FuncChain, runChain } from "./lib/functions-chain";
import { createFullContext, getBuiltinFunction, mongoAnonymousEventsStore, UDFWrapper } from "@jitsu/core-functions";
import { EventContext, JitsuFunction, Store, SystemContext } from "@jitsu/protocols/functions";
import { redis } from "@jitsu-internal/console/lib/server/redis";
import express from "express";
import NodeCache from "node-cache";
import hash from "object-hash";
import { UDFRunHandler } from "./http/udf";
import Prometheus from "prom-client";

setServerJsonFormat(process.env.LOG_FORMAT === "json");

const log = getLog("rotor");
const http = express();
http.use(express.json());
//cache connections for 20sec
const connectionsCache = new NodeCache({ stdTTL: 20, checkperiod: 60, useClones: false });
//cache functions for 20sec
const functionsCache = new NodeCache({ stdTTL: 20, checkperiod: 60, useClones: false });
//cache compiled udfs for 10min (ttl is extended on each access)
const udfTTL = 60 * 10;
const udfCache = new NodeCache({ stdTTL: udfTTL, checkperiod: 60, useClones: false });
udfCache.on("del", (key, value) => {
  log.atInfo().log(`UDF ${key} deleted from cache`);
  value.wrapper?.close();
});

const rotorHttpPort = process.env.ROTOR_HTTP_PORT || process.env.PORT || 3401;
const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");
const metricsDestinationId = process.env.METRICS_DESTINATION_ID;

const metricsFunction: Func | undefined = metricsDestinationId
  ? {
      id: "builtin.destination.bulker",
      config: {
        bulkerEndpoint: bulkerBase,
        destinationId: metricsDestinationId,
        authToken: bulkerAuthKey,
        dataLayout: "passthrough",
      },
      exec: requireDefined(
        getBuiltinFunction("builtin.destination.bulker"),
        `Unknown function builtin.destination.bulker`
      ) as JitsuFunction,
      context: {},
    }
  : undefined;

const getCachedOrLoad = async (cache: NodeCache, key: string, loader: (key: string) => Promise<any>) => {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const loaded = await loader(key);
  cache.set(key, loaded);
  return loaded;
};

export async function rotorMessageHandler(_message: string | undefined) {
  if (!_message) {
    return;
  }
  const message = JSON.parse(_message) as IngestMessage;
  const connection = requireDefined(
    await getCachedOrLoad(connectionsCache, message.connectionId, fastStore.getEnrichedConnection),
    `Unknown connection: ${message.connectionId}`
  );

  log
    .atDebug()
    .log(
      `Processing ${message.type} Message ID: ${message.messageId} for: ${connection.id} (${connection.streamId} → ${connection.destinationId}(${connection.type}))`
    );

  const connectionData = connection.options as any;

  let mainFunction;
  if (connection.usesBulker) {
    mainFunction = {
      functionId: "builtin.destination.bulker",
      functionOptions: {
        bulkerEndpoint: bulkerBase,
        destinationId: message.connectionId,
        authToken: bulkerAuthKey,
        dataLayout: connectionData.dataLayout ?? "segment-single-table",
      },
    };
  } else {
    const builtin = getBuiltinFunction(`builtin.destination.${connection.type}`);
    if (builtin) {
      mainFunction = {
        functionId: `builtin.destination.${connection.type}`,
        functionOptions: connection.credentials,
      };
    } else {
      throw newError(
        `Connection with id ${connection.id} has no functions assigned to it's destination type - ${connection.type}`
      );
    }
  }
  const functions = [...(connectionData.functions || []), mainFunction];
  //system context for builtin functions only
  const systemContext: SystemContext = {
    $system: {
      anonymousEventsStore: mongoAnonymousEventsStore(),
    },
  };

  const funcChain: FuncChain = await Promise.all(
    functions.map(async f => {
      if (f.functionId.startsWith("builtin.")) {
        return {
          id: f.functionId as string,
          config: f.functionOptions as any,
          exec: requireDefined(getBuiltinFunction(f.functionId), `Unknown function ${f.functionId}`) as JitsuFunction,
          context: systemContext,
        };
      } else if (f.functionId.startsWith("udf.")) {
        const functionId = f.functionId.substring(4);
        const userFunctionObj = requireDefined(
          await getCachedOrLoad(connectionsCache, functionId, key => {
            return fastStore.getConfig("function", key);
          }),
          `Unknown function: ${functionId}`
        );
        if (userFunctionObj.workspaceId !== connection.workspaceId) {
          throw newError(
            `Function ${functionId} is not in the same workspace as connection ${connection.id} (${connection.workspaceId})`
          );
        }
        const code = userFunctionObj.code;
        const codeHash = hash(code);
        let cached = await getCachedOrLoad(udfCache, functionId, async key => {
          return { wrapper: UDFWrapper(key, userFunctionObj.name, code), hash: codeHash };
        });
        if (cached.hash !== codeHash) {
          log.atInfo().log(`UDF ${functionId} changed (hash ${codeHash} != ${cached.hash}). Reloading`);
          cached = { wrapper: UDFWrapper(functionId, userFunctionObj.name, code), hash: codeHash };
          udfCache.set(functionId, cached);
        }
        udfCache.ttl(functionId, udfTTL);
        return {
          id: f.functionId as string,
          config: f.functionOptions as any,
          exec: cached.wrapper.userFunction,
          context: {},
        };
      } else {
        throw newError(`Function of unknown type: ${f.functionId}`);
      }
    })
  );
  const event = message.httpPayload as AnalyticsServerEvent;
  const ctx: EventContext = {
    headers: message.httpHeaders,
    source: {
      id: connection.streamId,
      domain: message.origin?.domain,
    },
    destination: {
      id: connection.destinationId,
      type: connection.type,
      updatedAt: connection.updatedAt,
      hash: connection.credentialsHash,
    },
    connection: {
      id: connection.id,
      mode: connection.mode,
      options: connection.options,
    },
  };
  const redisClient = redis();
  const redisLogger = createRedisLogger(
    redisClient,
    isErr => `events_log:functions.${isErr ? "error" : "all"}#${connection.id}`,
    false
  );
  const store: Store = {
    get: async (key: string) => {
      const res = await redisClient.hget(`store:${connection.id}`, key);
      return res ? JSON.parse(res) : undefined;
    },
    set: async (key: string, obj: any) => {
      await redisClient.hset(`store:${connection.id}`, key, JSON.stringify(obj));
    },
    del: async (key: string) => {
      await redisClient.hdel(`store:${connection.id}`, key);
    },
  };
  const chainCallback = async () =>
    await runChain(funcChain, event, connection, redisLogger, store, ctx).then(async execLog => {
      if (metricsFunction) {
        const processedIdx = execLog.findIndex(l => !l.dropped && l.functionId.startsWith("builtin.destination."));
        if (processedIdx >= 0) {
          const d = new Date();
          d.setMilliseconds(0);
          d.setSeconds(0);
          const event = {
            timestamp: d.toISOString(),
            workspaceId: connection.workspaceId,
            messageId: message.messageId,
            JITSU_TABLE_NAME: "active_incoming",
          };
          try {
            await metricsFunction.exec(
              event,
              createFullContext(
                metricsFunction.id,
                {
                  log: async () => {},
                },
                store,
                { headers: message.httpHeaders },
                {},
                metricsFunction.config
              )
            );
          } catch (e) {
            log.atError().withCause(e).log("Failed to send metrics");
          }
        }
      }
    });
  //50% chance
  if (connectionData.multithreading && Math.random() < 0.5) {
    queueMicrotask(chainCallback);
  } else {
    await chainCallback();
  }
}

const retrySettings = {
  maxMinutesInQueue: process.env.KAFKA_MAX_MINUTES_IN_QUEUE ? parseInt(process.env.KAFKA_MAX_MINUTES_IN_QUEUE) : 120,
};

async function main() {
  process.on("uncaughtException", function (err) {
    // Handle the error safely
    log.atError().withCause(err).log("UncaughtException");
  });

  const args = minimist(process.argv.slice(2));
  if (args._?.[0] === "local") {
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
  } else if (args._?.[0] === "test-connection") {
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
  } else {
    const kafkaTopic = destinationMessagesTopic();
    const consumerGroupId = rotorConsumerGroupId();
    const rotor = kafkaRotor({
      credentials: getCredentialsFromEnv(),
      kafkaTopic,
      consumerGroupId,
      maxSecondsInQueueAfterFailure: retrySettings.maxMinutesInQueue * 60,
      handle: rotorMessageHandler,
    });
    log.atInfo().log("Starting kafka processing");
    Prometheus.collectDefaultMetrics();

    rotor
      .start()
      .then(() => {
        log.atInfo().log(`Kafka processing started. Listening for topic ${kafkaTopic} with group ${consumerGroupId}`);
        http.get("/health", (req, res) => {
          res.send("OK");
        });
        http.get("/metrics", async (req, res) => {
          res.set("Content-Type", Prometheus.register.contentType);
          const result = await Prometheus.register.metrics();
          res.end(result);
        });
        http.post("/udfrun", UDFRunHandler);
        http.listen(rotorHttpPort, () => {
          log.atInfo().log(`Listening health-checks on port ${rotorHttpPort}`);
        });
      })
      .catch(e => {
        log.atError().withCause(e).log("Failed to start kafka processing");
        process.exit(1);
      });
  }
}

main();

export {};
