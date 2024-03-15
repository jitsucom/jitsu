import { getLog, isTruish, LogLevel, requireDefined } from "juava";

export const log = getLog("clickhouseLogger");

import { createClient } from "@clickhouse/client";
import { EventsStore } from "@jitsu/core-functions";

type LogEntry = {
  actorId: string;
  type: string;
  timestamp: Date;
  level: LogLevel;
  message: any;
};
function clickhouseHost() {
  if (process.env.CLICKHOUSE_URL) {
    return process.env.CLICKHOUSE_URL;
  }
  return `${isTruish(process.env.CLICKHOUSE_SSL) ? "https://" : "http://"}:${requireDefined(
    process.env.CLICKHOUSE_HOST,
    "env CLICKHOUSE_HOST is not defined"
  )}`;
}

export function createClickhouseLogger(): EventsStore {
  const buffer: LogEntry[] = [];
  const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";

  const clickhouse = createClient({
    host: clickhouseHost(),
    username: process.env.CLICKHOUSE_USERNAME || "default",
    password: requireDefined(process.env.CLICKHOUSE_PASSWORD, `env CLICKHOUSE_PASSWORD is not defined`),
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
      async_insert_max_data_size: "5000000",
      async_insert_busy_timeout_ms: 5000,
      date_time_input_format: "best_effort",
    },
  });

  const flush = async () => {
    if (buffer.length === 0) {
      return;
    }
    const copy = [...buffer];
    buffer.length = 0;
    const res = await clickhouse.insert<LogEntry>({
      table: metricsSchema + ".events_log",
      format: "JSONEachRow",
      values: copy,
    });
    if (res.executed) {
      log.atInfo().log(`Inserted ${copy.length} records.`);
    } else {
      log.atError().log(`Failed to insert ${copy.length} records: ${JSON.stringify(res)}`);
    }
  };

  const interval = setInterval(async () => {
    if (Object.keys(buffer).length === 0) {
      return;
    }
    await flush();
  }, 5000);

  return {
    log: (connectionId: string, level: LogLevel, message) => {
      const logEntry = {
        actorId: connectionId,
        type: "function",
        timestamp: new Date(),
        level,
        message,
      };
      buffer.push(logEntry);
    },
    close: () => {
      clearInterval(interval);
      clickhouse.close();
    },
  };
}
