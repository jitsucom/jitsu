import { createClient } from "@clickhouse/client";
import { getClickhouseConfig } from "juava";
import { getServerEnv } from "./serverEnv";

type ClickhouseClient = ReturnType<typeof createClient>;

let clickhouseClient: ClickhouseClient | undefined;

function getClickhouseClient(): ClickhouseClient {
  if (!clickhouseClient) {
    const serverEnv = getServerEnv();
    const chConfig = getClickhouseConfig(serverEnv);

    clickhouseClient = createClient({
      url: chConfig.url,
      username: chConfig.username,
      password: chConfig.password,
      database: chConfig.database,
      request_timeout: 180000,
      compression: {
        response: true,
      },
    });
  }

  return clickhouseClient;
}

export const clickhouse = new Proxy({} as ClickhouseClient, {
  get(_target, prop) {
    const client = getClickhouseClient();
    const value = client[prop as keyof ClickhouseClient];

    return typeof value === "function" ? value.bind(client) : value;
  },
}) as ClickhouseClient;

export function dateToClickhouse(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
}
