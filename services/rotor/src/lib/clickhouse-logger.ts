import { getLog, isTruish, LogLevel, requireDefined } from "juava";

const log = getLog("clickhouseLogger");

import { createClient } from "@clickhouse/client";
import { Readable } from "stream";
import { EventsStore } from "@jitsu/core-functions-lib";
import { getServerEnv } from "../serverEnv";

type LogEntry = [number, string, string, LogLevel, any];
type DeadLetterEntry = [number, string, string, string, any, any];

const serverEnv = getServerEnv();

export function clickhouseHost() {
  if (serverEnv.CLICKHOUSE_URL) {
    return serverEnv.CLICKHOUSE_URL;
  }
  return `${isTruish(serverEnv.CLICKHOUSE_SSL) ? "https://" : "http://"}${requireDefined(
    serverEnv.CLICKHOUSE_HOST,
    "env CLICKHOUSE_HOST is not defined"
  )}`;
}

export function createClickhouseLogger(): EventsStore {
  const logBuffer: LogEntry[] = [];
  const deadLetterBuffer: DeadLetterEntry[] = [];
  const metricsSchema = serverEnv.CLICKHOUSE_METRICS_SCHEMA || serverEnv.CLICKHOUSE_DATABASE || "newjitsu_metrics";

  const clickhouse = createClient({
    url: clickhouseHost(),
    username: serverEnv.CLICKHOUSE_USERNAME || "default",
    password: requireDefined(serverEnv.CLICKHOUSE_PASSWORD, `env CLICKHOUSE_PASSWORD is not defined`),
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
      async_insert_busy_timeout_ms: 10000,
      date_time_input_format: "best_effort",
    },
  });

  const flushLog = async () => {
    if (logBuffer.length === 0) {
      return;
    }
    const copy = logBuffer.slice();
    logBuffer.length = 0;
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

  const flushDeadLetter = async () => {
    if (deadLetterBuffer.length === 0) {
      return;
    }
    const copy = deadLetterBuffer.slice();
    deadLetterBuffer.length = 0;
    const eventsStream = new Readable({ objectMode: true });
    const res = clickhouse.insert<DeadLetterEntry>({
      table: metricsSchema + ".dead_letter",
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
          log.atDebug().log(`Inserted ${copy.length} deadletter records.`);
        } else {
          log.atError().log(`Failed to insert ${copy.length} deadletter records: ${JSON.stringify(res)}`);
        }
      })
      .catch(e => {
        log.atError().withCause(e).log(`Failed to insert ${copy.length} deadletter records`);
      });
  };

  const interval = setInterval(async () => {
    if (Object.keys(logBuffer).length === 0 && Object.keys(deadLetterBuffer).length === 0) {
      return;
    }
    await Promise.all([flushLog(), flushDeadLetter()]);
  }, 5000);

  return {
    log: (connectionId: string, level: LogLevel, message) => {
      logBuffer.push([Date.now(), connectionId, "function", level, message]);
    },
    deadLetter: (workspaceId: string, connectionId: string, type: string, message: any, error: any) => {
      deadLetterBuffer.push([Date.now(), workspaceId, connectionId, type, message, error]);
    },
    close: () => {
      clearInterval(interval);
      clickhouse.close();
    },
  };
}
