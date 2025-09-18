import { getLog, isTruish, LogLevel, requireDefined } from "juava";

const log = getLog("clickhouseLogger");

import { createClient } from "@clickhouse/client";
import { EventsStore } from "./index";
import { Readable } from "stream";

type LogEntry = [number, string, string, LogLevel, any];

function clickhouseHost() {
  if (process.env.CLICKHOUSE_URL) {
    return process.env.CLICKHOUSE_URL;
  }
  return `${isTruish(process.env.CLICKHOUSE_SSL) ? "https://" : "http://"}${requireDefined(
    process.env.CLICKHOUSE_HOST,
    "env CLICKHOUSE_HOST is not defined"
  )}`;
}

export function createClickhouseLogger(): EventsStore {
  const buffer: LogEntry[] = [];
  const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";

  const clickhouse = createClient({
    url: clickhouseHost(),
    username: process.env.CLICKHOUSE_USERNAME || "default",
    password: requireDefined(process.env.CLICKHOUSE_PASSWORD, `env CLICKHOUSE_PASSWORD is not defined`),
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
      async_insert_busy_timeout_ms: 10000,
      date_time_input_format: "best_effort",
    },
  });

  const flush = async () => {
    if (buffer.length === 0) {
      return;
    }
    const copy = buffer.slice();
    buffer.length = 0;
    const eventsStream = new Readable({ objectMode: true });
    const res = clickhouse.insert<LogEntry>({
      table: metricsSchema + ".events_log",
      format: "JSONCompactEachRow",
      values: eventsStream,
    });
    const asyncWrite = async () => {
      for (let i = 0; i < copy.length; i++) {
        eventsStream.push(copy[i]);
      }
      eventsStream.push(null);
      return res;
    };
    return asyncWrite()
      .then(res => {
        if (res.executed) {
          log.atDebug().log(`Inserted ${copy.length} records.`);
        } else {
          log.atError().log(`Failed to insert ${copy.length} records: ${JSON.stringify(res)}`);
        }
      })
      .catch(e => {
        log.atError().withCause(e).log(`Failed to insert ${copy.length} records`);
      });
  };

  const interval = setInterval(async () => {
    if (Object.keys(buffer).length === 0) {
      return;
    }
    await flush();
  }, 5000);

  return {
    log: (connectionId: string, level: LogLevel, message) => {
      const logEntry: LogEntry = [Date.now(), connectionId, "function", level, message];
      buffer.push(logEntry);
    },
    close: () => {
      clearInterval(interval);
      clickhouse.close();
    },
  };
}
