import { createClient } from "@clickhouse/client";
import { isTruish } from "juava";
import { getServerLog } from "./log";

const log = getServerLog("clickhouse");

function clickhouseHost() {
  if (process.env.CLICKHOUSE_URL) {
    return process.env.CLICKHOUSE_URL;
  }
  if (!process.env.CLICKHOUSE_HOST) {
    log.atError().log("env CLICKHOUSE_HOST is not defined, using default 'localhost'");
    return "http://localhost";
  }
  return `${isTruish(process.env.CLICKHOUSE_SSL) ? "https://" : "http://"}${process.env.CLICKHOUSE_HOST}`;
}

export const clickhouse = createClient({
  url: clickhouseHost(),
  username: process.env.CLICKHOUSE_USERNAME || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  compression: {
    response: true,
  },
});

export function dateToClickhouse(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
}
