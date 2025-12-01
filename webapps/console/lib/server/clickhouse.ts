import { createClient } from "@clickhouse/client";
import { getServerLog } from "./log";
import { getServerEnv } from "./serverEnv";

const log = getServerLog("clickhouse");

function clickhouseHost() {
  const serverEnv = getServerEnv();
  if (serverEnv.CLICKHOUSE_URL) {
    return serverEnv.CLICKHOUSE_URL;
  }
  if (!serverEnv.CLICKHOUSE_HOST) {
    log.atError().log("env CLICKHOUSE_HOST is not defined, using default 'localhost'");
    return "http://localhost";
  }
  return `${serverEnv.CLICKHOUSE_SSL ? "https://" : "http://"}${serverEnv.CLICKHOUSE_HOST}`;
}

const serverEnv = getServerEnv();
export const clickhouse = createClient({
  url: clickhouseHost(),
  username: serverEnv.CLICKHOUSE_USERNAME || "default",
  password: serverEnv.CLICKHOUSE_PASSWORD || "",
  request_timeout: 180000,
  compression: {
    response: true,
  },
});

export function dateToClickhouse(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
}
