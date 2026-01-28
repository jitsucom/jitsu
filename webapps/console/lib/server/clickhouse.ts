import { createClient } from "@clickhouse/client";
import { getClickhouseConfig } from "juava";
import { getServerEnv } from "./serverEnv";

const serverEnv = getServerEnv();
const chConfig = getClickhouseConfig(serverEnv);

export const clickhouse = createClient({
  url: chConfig.url,
  username: chConfig.username,
  password: chConfig.password,
  database: chConfig.database,
  request_timeout: 180000,
  compression: {
    response: true,
  },
});

export function dateToClickhouse(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
}
