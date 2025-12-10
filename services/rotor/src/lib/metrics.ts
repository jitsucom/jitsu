import { getLog, isTruish, requireDefined, stopwatch } from "juava";
import { FunctionExecLog, FunctionExecRes, RotorMetrics, StoreMetrics } from "@jitsu/destination-functions";

import { KafkaJS } from "@confluentinc/kafka-javascript";
import { Readable } from "stream";
import { Counter, Gauge, Histogram } from "prom-client";
import { createClient } from "@clickhouse/client";
import { getServerEnv } from "../serverEnv";

const log = getLog("metrics");
const serverEnv = getServerEnv();
const metricsDestinationId = serverEnv.METRICS_DESTINATION_ID;
const billingMetricsTable = "active_incoming";
const metricsTable = "metrics";

const max_batch_size = 10000;
const flush_interval_ms = 60000;

export const promStoreStatuses = new Counter({
  name: "rotor_store_statuses",
  help: "rotor store statuses",
  labelNames: ["namespace", "operation", "status"] as const,
});
export const promWarehouseStatuses = new Histogram({
  name: "rotor_warehouse_statuses",
  help: "rotor warehouse statuses",
  labelNames: ["id", "table", "status"] as const,
  buckets: [0.02, 0.05, 0.2, 0.5, 1, 2], // durations in seconds
});
export const promTopicOffsets = new Gauge({
  name: "rotor_topic_offsets2",
  help: "topic offsets",
  // add `as const` here to enforce label names
  labelNames: ["topic", "partition", "offset"] as const,
});
export const promMessagesConsumed = new Counter({
  name: "rotor_messages_consumed",
  help: "messages consumed",
  // add `as const` here to enforce label names
  labelNames: ["topic", "partition"] as const,
});
export const promMessagesProcessed = new Counter({
  name: "rotor_messages_processed",
  help: "messages processed",
  labelNames: ["topic", "partition"] as const,
});
export const promMessagesRequeued = new Counter({
  name: "rotor_messages_requeued",
  help: "messages requeued",
  labelNames: ["topic"] as const,
});
export const promMessagesDeadLettered = new Counter({
  name: "rotor_messages_dead_lettered",
  help: "messages dead lettered",
  labelNames: ["topic"] as const,
});
export const promConnectionMessageStatuses = new Counter({
  name: "connection_message_statuses",
  help: "connection message statuses",
  labelNames: ["destinationId", "tableName", "status"] as const,
});
export const promFunctionsInFlight = new Gauge({
  name: "rotor_functions_in_flight",
  help: "Functions in flight",
  // add `as const` here to enforce label names
  labelNames: ["connectionId", "functionId"] as const,
});
export const promFunctionsTime = new Histogram({
  name: "rotor_functions_time",
  help: "Functions execution time in ms",
  buckets: [1, 10, 100, 200, 1000, 2000, 3000, 4000, 5000],
  // add `as const` here to enforce label names
  labelNames: ["connectionId", "functionId"] as const,
});
export const promHandlerMetric = new Counter({
  name: "rotor_function_handler",
  help: "function handler status",
  labelNames: ["connectionId", "status"] as const,
});
export const promQueueSize = new Gauge({
  name: "profiles_queue_size",
  help: "profiles queue size",
  // add `as const` here to enforce label names
  labelNames: ["builderId", "priority"] as const,
});
export const promQueueProcessed = new Counter({
  name: "profiles_queue_processed",
  help: "profiles queuue processed",
  labelNames: ["builderId", "priority"] as const,
});
export const promProfileStatuses = new Histogram({
  name: "profiles_statuses",
  help: "profiles statuses",
  buckets: [0.2, 1, 2, 5, 10, 60, 300], // durations in seconds
  labelNames: ["builderId", "priority", "status"] as const,
});

const _EpochTime = 0;
const _MessageId = 1;
const _WorkspaceId = 2;
const _StreamId = 3;
const _ConnectionId = 4;
const _FunctionId = 5;
const _DestinationId = 6;
const _Status = 7;
const _Count = 8;
const _EventIndex = 9;

type MetricsEvent = [number, string, string, string, string, string, string, string, number, number];

export const DummyMetrics: RotorMetrics = {
  logMetrics: () => {},
  storeStatus: () => {},
  warehouseStatus: () => {},
  close: () => {},
};

export function createMetrics(producer?: KafkaJS.Producer): RotorMetrics {
  const buffer: MetricsEvent[] = [];
  const metricsSchema = serverEnv.CLICKHOUSE_METRICS_SCHEMA || serverEnv.CLICKHOUSE_DATABASE || "newjitsu_metrics";

  const clickhouse = createClient({
    url: clickhouseHost(),
    username: serverEnv.CLICKHOUSE_USERNAME || "default",
    password: requireDefined(serverEnv.CLICKHOUSE_PASSWORD, `env CLICKHOUSE_PASSWORD is not defined`),
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
      async_insert_busy_timeout_ms: 30000,
      date_time_input_format: "best_effort",
    },
  });

  const flushBillingMetrics = async (buf: MetricsEvent[]) => {
    if (producer) {
      const asyncWrite = async () => {
        return producer.send({
          topic: `in.id.metrics.m.batch.t.${billingMetricsTable}`,
          messages: buf
            .filter(m => m[_FunctionId].startsWith("builtin.destination.") && m[_Status] !== "dropped")
            .map(m => {
              const hourTrunc = Math.floor(m[_EpochTime] / 3600) * 3600;
              const d = new Date(hourTrunc * 1000);
              const key = m[_MessageId] + "_" + m[_EventIndex] + "_" + (m[_EpochTime] - hourTrunc);
              return {
                key: key,
                value: JSON.stringify({
                  timestamp: d,
                  workspaceId: m[_WorkspaceId],
                  // to count active events use composed key: messageId_eventIndex_receivedAt
                  messageId: key,
                }),
              };
            }),
        });
      };
      return asyncWrite().catch(e => {
        log.atError().withCause(e).log(`Failed to flush billing metrics`);
      });
    } else {
      const billingStream = new Readable({ objectMode: true });
      const billingResponse = clickhouse.insert({
        table: metricsSchema + "." + billingMetricsTable,
        format: "JSONCompactEachRow",
        values: billingStream,
      });

      const asyncWrite = async () => {
        for (let i = 0; i < buf.length; i++) {
          const m = buf[i];
          if (m[_FunctionId].startsWith("builtin.destination.") && m[_Status] !== "dropped") {
            const hourTrunc = Math.floor(m[_EpochTime] / 3600) * 3600;
            const key = m[_MessageId] + "_" + m[_EventIndex] + "_" + (m[_EpochTime] - hourTrunc);
            billingStream.push([hourTrunc, m[_WorkspaceId], key]);
          }
        }
        billingStream.push(null);
        return billingResponse;
      };
      return asyncWrite()
        .then(async r => {
          if (!r.executed) {
            log.atError().log(`Failed to insert ${buf.length} billing metrics: ${JSON.stringify(r)}`);
          }
        })
        .catch(e => {
          log.atError().withCause(e).log(`Failed to insert billing metrics.`);
        });
    }
  };

  const flush = async (buf: MetricsEvent[]) => {
    const promises: Promise<any>[] = [flushBillingMetrics(buf)];

    const metricsStream = new Readable({ objectMode: true });
    const metricsResponse = clickhouse.insert({
      table: metricsSchema + "." + metricsTable,
      format: "JSONCompactEachRow",
      values: metricsStream,
    });
    const asyncWrite = async () => {
      for (let i = 0; i < buf.length; i++) {
        metricsStream.push(buf[i]);
      }
      metricsStream.push(null);
      return metricsResponse;
    };

    promises.push(
      asyncWrite()
        .then(async r => {
          if (!r.executed) {
            log.atError().log(`Failed to insert ${buf.length} records: ${JSON.stringify(r)}`);
          }
        })
        .catch(e => {
          log.atError().withCause(e).log(`Failed to flush metrics events`);
        })
    );

    await Promise.all(promises);
  };

  const interval = setInterval(async () => {
    const length = buffer.length;
    if (length > 0) {
      const sw = stopwatch();
      try {
        const copy = buffer.slice();
        buffer.length = 0;
        await flush(copy);
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

      for (let i = 0; i < execLog.length; i++) {
        const el = execLog[i];
        if (!el.metricsMeta) {
          continue;
        }
        const status = ((el: FunctionExecRes) => {
          if (el.metricsMeta?.retries) {
            promConnectionMessageStatuses.inc({
              destinationId: el.metricsMeta!.connectionId,
              tableName: "_all_",
              status: "retry",
            });
          }
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
            promConnectionMessageStatuses.inc({
              destinationId: el.metricsMeta!.connectionId,
              tableName: "_all_",
              status: "error",
            });
            status = "error";
            if (el.dropped) {
              promConnectionMessageStatuses.inc({
                destinationId: el.metricsMeta!.connectionId,
                tableName: "_all_",
                status: "drop",
              });
            }
          } else if (el.dropped) {
            prefix = "";
            status = "dropped";
            promConnectionMessageStatuses.inc({
              destinationId: el.metricsMeta!.connectionId,
              tableName: "_all_",
              status: "drop",
            });
          } else if (el.functionId === "builtin.destination.bulker") {
            status = "processed";
          } else {
            promConnectionMessageStatuses.inc({
              destinationId: el.metricsMeta!.connectionId,
              tableName: "_all_",
              status: "success",
            });
          }
          return prefix + status;
        })(el);
        buffer.push([
          Math.floor((el.receivedAt ? el.receivedAt.getTime() : Date.now()) / 1000),
          el.metricsMeta.messageId,
          el.metricsMeta.workspaceId,
          el.metricsMeta.streamId,
          el.metricsMeta.connectionId,
          el.functionId,
          el.metricsMeta.destinationId,
          status,
          1,
          el.eventIndex,
        ]);
      }
      if (buffer.length >= max_batch_size) {
        const sw = stopwatch();
        const copy = buffer.slice();
        buffer.length = 0;
        setImmediate(async () =>
          flush(copy)
            .then(() => log.atDebug().log(`Flushed ${copy.length} metrics events. Took: ${sw.elapsedPretty()}`))
            .catch(e => {
              log.atError().withCause(e).log(`Failed to flush metrics`);
            })
        );
      }
    },
    storeStatus: (namespace: string, operation: string, status: string) => {
      promStoreStatuses.labels(namespace, operation, status).inc();
    },
    warehouseStatus: (id: string, table: string, status: string, timeMs: number) => {
      promWarehouseStatuses.labels(id, table, status).observe(timeMs / 1000);
    },
    close: () => {
      clearInterval(interval);
      clickhouse.close();
    },
  };
}

function clickhouseHost() {
  if (serverEnv.CLICKHOUSE_URL) {
    return serverEnv.CLICKHOUSE_URL;
  }
  return `${isTruish(serverEnv.CLICKHOUSE_SSL) ? "https://" : "http://"}${requireDefined(
    serverEnv.CLICKHOUSE_HOST,
    "env CLICKHOUSE_HOST is not defined"
  )}`;
}

export const metrics: StoreMetrics = {
  storeStatus: (namespace: string, operation: string, status: string) => {
    promStoreStatuses.labels(namespace, operation, status).inc();
  },
  warehouseStatus: (id: string, table: string, status: string, timeMs: number) => {
    promWarehouseStatuses.labels(id, table, status).observe(timeMs / 1000);
  },
};
