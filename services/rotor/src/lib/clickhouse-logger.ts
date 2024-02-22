import { getLog, LogLevel, requireDefined } from "juava";

export const log = getLog("clickhouseLogger");

import { createClient } from "@clickhouse/client";
import { EventsStore } from "@jitsu/core-functions";
import { RateLimiterMemory } from "rate-limiter-flexible";

type LogEntry = {
  actorId: string;
  type: string;
  timestamp: Date;
  level: LogLevel;
  message: any;
};

export function createClickhouseLogger(): EventsStore {
  const buffer: LogEntry[] = [];

  const clickhouse = createClient({
    host: requireDefined(process.env.CLICKHOUSE_URL, `env CLICKHOUSE_URL is not defined`),
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

  const rateLimiter = new RateLimiterMemory({
    points: 20,
    duration: 5,
  });

  const flush = async () => {
    if (buffer.length === 0) {
      return;
    }
    const copy = [...buffer];
    buffer.length = 0;
    const res = await clickhouse.insert<LogEntry>({
      table: "newjitsu_metrics.events_log",
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
      if (level === "debug") {
        return;
      }
      rateLimiter
        .consume(connectionId + "_" + level, 1)
        .then(() => {
          const logEntry = {
            actorId: connectionId,
            type: "function",
            timestamp: new Date(),
            level,
            message,
          };
          buffer.push(logEntry);
        })
        .catch(() => {});
    },
    close: () => {
      clearInterval(interval);
      clickhouse.close();
    },
  };
}
