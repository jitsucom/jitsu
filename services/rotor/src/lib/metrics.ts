import { getLog, requireDefined, stopwatch } from "juava";
import fetch from "node-fetch-commonjs";
import {
  FunctionExecLog,
  FunctionExecRes,
  MetricsMeta,
  httpAgent,
  httpsAgent,
  RotorMetrics,
} from "@jitsu/core-functions";

import omit from "lodash/omit";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import { Readable } from "stream";
import { Counter } from "prom-client";

const log = getLog("metrics");
const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");
const metricsDestinationId = process.env.METRICS_DESTINATION_ID;
const billingMetricsTable = "active_incoming";
const metricsTable = "metrics";

const max_batch_size = 10000;
const flush_interval_ms = 60000;

type MetricsEvent = MetricsMeta & {
  key: string;
  functionId: string;
  timestamp: Date;
  status: string;
  events: number;
};

export const DummyMetrics: RotorMetrics = {
  logMetrics: () => {},
  storeStatus: () => {},
  close: () => {},
};

export function createMetrics(
  producer?: KafkaJS.Producer,
  storeCounter?: Counter<"namespace" | "operation" | "status">
): RotorMetrics {
  const buffer: MetricsEvent[] = [];

  const flush = async (buf: MetricsEvent[]) => {
    if (producer) {
      await Promise.all([
        producer.send({
          topic: `in.id.metrics.m.batch.t.${metricsTable}`,
          messages: buf.map(m => ({
            key: m.key,
            value: JSON.stringify(omit(m, "retries", "messageId", "key")),
          })),
        }),
        producer.send({
          topic: `in.id.metrics.m.batch.t.${billingMetricsTable}`,
          messages: buf
            .filter(m => m.functionId.startsWith("builtin.destination.") && m.status !== "dropped")
            .map(m => {
              const d = new Date(m.timestamp);
              d.setMinutes(0);
              return {
                key: m.key,
                value: JSON.stringify({
                  timestamp: d,
                  workspaceId: m.workspaceId,
                  messageId: m.messageId,
                }),
              };
            }),
        }),
      ]);
    } else {
      //create readable stream
      const streamOld = new Readable();
      const resOld = fetch(`${bulkerBase}/bulk/${metricsDestinationId}?tableName=${billingMetricsTable}&mode=batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bulkerAuthKey}` },
        body: streamOld,
        agent: (bulkerBase.startsWith("https://") ? httpsAgent : httpAgent)(),
      });
      const stream = new Readable();
      const res = fetch(`${bulkerBase}/bulk/${metricsDestinationId}?tableName=${metricsTable}&mode=batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bulkerAuthKey}` },
        body: stream,
        agent: (bulkerBase.startsWith("https://") ? httpsAgent : httpAgent)(),
      });
      buf.forEach(e => {
        if (e.functionId.startsWith("builtin.destination.") && e.status !== "dropped") {
          streamOld.push(
            JSON.stringify({
              timestamp: e.timestamp,
              workspaceId: e.workspaceId,
              messageId: e.messageId,
            })
          );
          streamOld.push("\n");
        }
        stream.push(JSON.stringify(omit(e, "retries", "messageId")));
        stream.push("\n");
      });
      //close stream
      streamOld.push(null);
      stream.push(null);
      await Promise.all([
        resOld
          .then(async r => {
            if (!r.ok) {
              log.atError().log(`Failed to flush metrics events(old): ${r.status} ${r.statusText}`);
            }
          })
          .catch(e => {
            log.atError().withCause(e).log(`Failed to flush metrics events(old)`);
          }),
        res
          .then(async r => {
            if (!r.ok) {
              log.atError().log(`Failed to flush metrics events: ${r.status} ${r.statusText}`);
            }
          })
          .catch(e => {
            log.atError().withCause(e).log(`Failed to flush metrics events`);
          }),
      ]);
    }
  };

  const interval = setInterval(async () => {
    const length = buffer.length;
    if (length > 0) {
      const sw = stopwatch();
      try {
        const copy = [...buffer];
        await flush(copy);
        buffer.length = 0;
        log.atDebug().log(`Periodic flushing ${copy.length} metrics events took ${sw.elapsedPretty()}`);
      } catch (e) {
        log.atError().withCause(e).log(`Failed to flush metrics`);
      }
    }
  }, flush_interval_ms);

  return {
    logMetrics: (execLog: FunctionExecLog) => {
      if (!metricsDestinationId) {
        return;
      }

      for (const el of execLog) {
        if (!el.metricsMeta) {
          continue;
        }
        const d = el.receivedAt || new Date();
        d.setMilliseconds(0);
        d.setSeconds(0);
        // console.log(
        //   `${el.metricsMeta.connectionId} ${el.metricsMeta.messageId} ${el.functionId} ${el.error} ${el.dropped} ${el.metricsMeta.retries}`
        // );
        const status = ((el: FunctionExecRes) => {
          let prefix = el.functionId.startsWith("builtin.destination.")
            ? ""
            : el.functionId.startsWith("builtin.transformation.")
            ? "builtin_function_"
            : "function_";
          let status = "success";
          if (el.error) {
            if (el.metricsMeta?.retries) {
              prefix = prefix + "retry_";
            }
            status = "error";
          } else if (el.dropped) {
            prefix = "";
            status = "dropped";
          } else if (el.functionId === "builtin.destination.bulker") {
            status = "processed";
          }
          return prefix + status;
        })(el);
        buffer.push({
          key: crypto.randomUUID(),
          timestamp: d,
          ...omit(el.metricsMeta, "retries"),
          functionId: el.functionId,
          status,
          events: 1,
        });
      }
      if (buffer.length >= max_batch_size) {
        const sw = stopwatch();
        const copy = [...buffer];
        setImmediate(async () =>
          flush(copy)
            .then(() => log.atDebug().log(`Flushed ${copy.length} metrics events. Took: ${sw.elapsedPretty()}`))
            .catch(e => {
              log.atError().withCause(e).log(`Failed to flush metrics`);
            })
        );
        buffer.length = 0;
      }
    },
    storeStatus: (namespace: string, operation: string, status: string) => {
      if (storeCounter) {
        storeCounter.labels(namespace, operation, status).inc();
      }
    },
    close: () => {
      clearInterval(interval);
    },
  };
}
