import * as path from "path";
import { DockerComposeEnvironment } from "testcontainers";
import { getLog } from "juava";
import * as JSON5 from "json5";

const fp = require("find-free-port");

export function e2eTestEnabled(silent: boolean = false): boolean {
  const enabled = process.env.E2E_ENABLE === "true" || process.env.E2E_ENABLE === "1";
  if (!enabled && !silent) {
    log.atInfo().log("E2E tests are disabled. Set E2E_ENABLE=1 to enable them!");
  }
  return enabled;
}
export type Ports = {
  redis: number;
  postgres: number;
  bulker: number;
  web: number;
  redisInsights: number;
  kafkaConsole: number;
};

export const defaultPorts: Ports = {
  redis: 6380,
  postgres: 5438,
  bulker: 3042,
  web: 3000,
  redisInsights: 3011,
  kafkaConsole: 3032,
};

const log = getLog("env");

export type TestEnv = {
  ports: Ports;
};

export async function prepareTestEnvironment(): Promise<[TestEnv, () => Promise<void>]> {
  if (
    process.env.USE_EXTERNAL_ENV &&
    (process.env.USE_EXTERNAL_ENV === "true" || process.env.USE_EXTERNAL_ENV === "1")
  ) {
    log.atInfo().log("Using external environment");
    return [
      { ports: process.env.SERVICES_PORTS ? JSON5.parse(process.env.SERVICES_PORTS) : defaultPorts },
      async () => {},
    ];
  } else {
    const composeFilePath = path.resolve(__dirname, "../../devenv");
    const composeFile = "docker-compose.yml";
    const ports: Ports = Object.fromEntries(
      await Promise.all(Object.entries(defaultPorts).map(async ([k, v]) => [k, await fp(v)]))
    ) as Ports;
    const dockerEnv = {
      REDIS_PORT: ports.redis.toString(),
      RI_PORT: ports.redisInsights.toString(),
      PG_PORT: ports.postgres.toString(),
      KAFKA_CONSOLE_PORT: ports.kafkaConsole.toString(),
      BULKER_PORT: ports.bulker.toString(),
    };
    log.atInfo().log(
      "Starting docker compose environment:\n",
      Object.entries(dockerEnv)
        .map(([k, v]) => `${k.padStart(25)} = ${v}`)
        .join("\n")
    );
    const environment = await new DockerComposeEnvironment(composeFilePath, composeFile)
      .withEnvironment(dockerEnv)
      .up();
    log.atInfo().log("Docker compose environment started");
    return [
      { ports },
      async () => {
        try {
          await environment.down();
        } catch (e) {
          log.atWarn().withCause(e).log("Failed to stop docker compose environment");
        }
      },
    ];
  }
}
