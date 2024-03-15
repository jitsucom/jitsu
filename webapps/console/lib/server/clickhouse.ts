import { createClient } from "@clickhouse/client";
import { isTruish, requireDefined } from "juava";

function clickhouseHost() {
  if (process.env.CLICKHOUSE_URL) {
    return process.env.CLICKHOUSE_URL;
  }
  return `${isTruish(process.env.CLICKHOUSE_SSL) ? "https://" : "http://"}:${requireDefined(
    process.env.CLICKHOUSE_HOST,
    "env CLICKHOUSE_HOST is not defined"
  )}}`;
}

export const clickhouse = createClient({
  host: clickhouseHost(),
  username: process.env.CLICKHOUSE_USERNAME || "default",
  password: requireDefined(process.env.CLICKHOUSE_PASSWORD, `env CLICKHOUSE_PASSWORD is not defined`),
});
