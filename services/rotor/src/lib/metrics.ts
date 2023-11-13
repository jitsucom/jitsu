import { stopwatch } from "juava";
import { getServerLog } from "@jitsu-internal/console/lib/server/log";
import { FunctionExecLog, FunctionExecRes } from "./functions-chain";
import { MetricsMeta } from "@jitsu/core-functions";
import omit from "lodash/omit";
import type { Producer } from "kafkajs";

export const log = getServerLog("metrics");

const metricsDestinationId = process.env.METRICS_DESTINATION_ID;

const max_batch_size = 1000;
const flush_interval_ms = 60000;

type MetricsEvent = MetricsMeta & {
  functionId: string;
  timestamp: string;
  status: string;
  events: number;
};

export interface Metrics {
  logMetrics: (execLog: FunctionExecLog) => Promise<void>;
}

export function createMetrics(producer: Producer): Metrics {
  const buffer: MetricsEvent[] = [];

  const flush = async (buf: MetricsEvent[]) => {
    await Promise.all([
      producer.send({
        topic: `in.id.metrics.m.batch.t.metrics`,
        messages: buf.map(m => ({
          value: JSON.stringify(m),
        })),
      }),
      producer.send({
        topic: `in.id.metrics.m.batch.t.active_incoming`,
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
  };

  setInterval(async () => {
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

      const d = new Date();
      d.setMilliseconds(0);
      d.setSeconds(0);

      for (const el of execLog) {
        if (!el.metricsMeta) {
          continue;
        }
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
  };
}
