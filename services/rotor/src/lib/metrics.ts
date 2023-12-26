import { getLog, requireDefined, stopwatch } from "juava";
import { FunctionExecLog, FunctionExecRes } from "./functions-chain";
import fetch from "node-fetch-commonjs";
import { MetricsMeta, httpAgent, httpsAgent } from "@jitsu/core-functions";

import omit from "lodash/omit";
import type { Producer } from "kafkajs";
import { getCompressionType } from "./rotor";
import { Readable } from "stream";

export const log = getLog("metrics");
const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");
const metricsDestinationId = process.env.METRICS_DESTINATION_ID;
const oldMetricsTable = "active_incoming";
const metricsTable = "metrics";

const max_batch_size = 10000;
const flush_interval_ms = 60000;

type MetricsEvent = MetricsMeta & {
  functionId: string;
  timestamp: string;
  status: string;
  events: number;
};

export interface Metrics {
  logMetrics: (execLog: FunctionExecLog) => Promise<void>;
  close: () => void;
}

export function createMetrics(producer?: Producer): Metrics {
  const buffer: MetricsEvent[] = [];

  const flush = async (buf: MetricsEvent[]) => {
    const d = new Date();
    d.setMilliseconds(0);
    d.setSeconds(0);
    if (producer) {
      await Promise.all([
        producer.send({
          topic: `in.id.metrics.m.batch.t.${metricsTable}`,
          compression: getCompressionType(),
          messages: buf.map(m => ({
            value: JSON.stringify({
              ...m,
              timestamp: d.toISOString(),
            }),
          })),
        }),
        producer.send({
          topic: `in.id.metrics.m.batch.t.${oldMetricsTable}`,
          compression: getCompressionType(),
          messages: buf
            .filter(m => m.functionId.startsWith("builtin.destination.") && m.status !== "dropped")
            .map(m => ({
              value: JSON.stringify({
                timestamp: m.timestamp,
                workspaceId: m.workspaceId,
                messageId: m.messageId,
              }),
            })),
        }),
      ]);
    } else {
      //create readable stream
      const streamOld = new Readable();
      const resOld = fetch(`${bulkerBase}/bulk/${metricsDestinationId}?tableName=${oldMetricsTable}&mode=batch`, {
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
        stream.push(JSON.stringify(omit(e, "retries")));
        stream.push("\n");
      });
      //close stream
      streamOld.push(null);
      stream.push(null);
      await Promise.all([
        resOld
          .then(async r => {
            if (r.ok) {
              log.atInfo().log(`Flushed metrics events(old): ${((await r.json()) as any).state.successfulRows}`);
            } else {
              log.atError().log(`Failed to flush metrics events(old): ${r.status} ${r.statusText}`);
            }
          })
          .catch(e => {
            log.atError().withCause(e).log(`Failed to flush metrics events(old)`);
          }),
        res
          .then(async r => {
            if (r.ok) {
              log.atInfo().log(`Flushed metrics events: ${((await r.json()) as any).state.successfulRows}`);
            } else {
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
        await flush([...buffer]);
        buffer.length = 0;
        log.atInfo().log(`Periodic flushing ${length} metrics events took ${sw.elapsedPretty()}`);
      } catch (e) {
        log.atError().withCause(e).log(`Failed to flush metrics`);
      }
    }
  }, flush_interval_ms);

  return {
    logMetrics: async (execLog: FunctionExecLog) => {
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
          timestamp: d.toISOString(),
          ...omit(el.metricsMeta, "retries"),
          functionId: el.functionId,
          status,
          events: 1,
        });
      }
      if (buffer.length >= max_batch_size) {
        log.atInfo().log(`Flushing ${buffer.length} metrics events`);
        const copy = [...buffer];
        setImmediate(() => flush(copy));
        buffer.length = 0;
      }
    },
    close: () => {
      clearInterval(interval);
    },
  };
}
