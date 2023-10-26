import { createClient } from "@clickhouse/client";
import { requireDefined } from "juava";

export const clickhouse = createClient({
  host: requireDefined(process.env.CLICKHOUSE_URL, `env CLICKHOUSE_URL is not defined`),
  username: process.env.CLICKHOUSE_USERNAME || "default",
  password: requireDefined(process.env.CLICKHOUSE_PASSWORD, `env CLICKHOUSE_PASSWORD is not defined`),
});
