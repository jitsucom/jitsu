import { z } from "zod";

// Server environment schema
const ServerEnvSchema = z.object({
  // Logging
  LOG_FORMAT: z.string().optional().default("text"),
  NODE_ENV: z.string().optional().default("development"),

  // HTTP Server Configuration
  ROTOR_HTTP_PORT: z.string().optional().default("3401"),
  PORT: z.string().optional().default("3401"),
  ROTOR_METRICS_PORT: z.string().optional().default("9091"),
  ROTOR_MODE: z.enum(["rotor", "profiles", "functions"]).optional().default("rotor"),
  HTTP_ONLY: z.string().optional().default("false"),

  // ClickHouse Configuration
  CLICKHOUSE_HOST: z.string().optional(),
  CLICKHOUSE_URL: z.string().optional(),
  CLICKHOUSE_SSL: z.string().optional().default("false"),
  CLICKHOUSE_USERNAME: z.string().optional().default("default"),
  CLICKHOUSE_PASSWORD: z.string().optional(),
  CLICKHOUSE_DATABASE: z.string().optional().default("newjitsu_metrics"),
  CLICKHOUSE_METRICS_SCHEMA: z.string().optional().default("newjitsu_metrics"),

  // Redis Configuration
  REDIS_URL: z.string().optional(),
  REDIS_SENTINEL_ADDRESS: z.string().optional(),

  REQUIRED_STORES: z.string().optional(),

  // MaxMind Configuration
  MAXMIND_LICENSE_KEY: z.string().optional(),
  MAXMIND_URL: z.string().optional(),
  MAXMIND_S3_BUCKET: z.string().optional(),
  MAXMIND_S3_REGION: z.string().optional(),
  MAXMIND_S3_ACCESS_KEY_ID: z.string().optional(),
  MAXMIND_S3_SECRET_ACCESS_KEY: z.string().optional(),
  MAXMIND_S3_ENDPOINT: z.string().optional(),
  MAXMIND_S3_FORCE_PATH_STYLE: z.string().optional().default("false"),
  MAXMIND_LOCALE: z.string().optional(),

  // Kafka Configuration
  KAFKA_BOOTSTRAP_SERVERS: z.string().optional(),
  KAFKA_SSL: z.string().optional().default("false"),
  KAFKA_SSL_SKIP_VERIFY: z.string().optional().default("false"),
  KAFKA_SASL: z.string().optional(),
  KAFKA_SSL_CA: z.string().optional(),
  KAFKA_SSL_CA_FILE: z.string().optional(),
  KAFKA_DESTINATIONS_TOPIC_NAME: z.string().optional().default("destination-messages"),
  KAFKA_DESTINATIONS_DEAD_LETTER_TOPIC_NAME: z.string().optional().default("destination-messages-dead-letter"),
  KAFKA_DESTINATIONS_RETRY_TOPIC_NAME: z.string().optional().default("destination-messages-retry"),
  KAFKA_DESTINATIONS_MT_TOPIC_NAME: z.string().optional().default("destination-messages-mt"),
  KAFKA_CONSUMER_GROUP_ID: z.string().optional(),
  KAFKA_TOPIC_COMPRESSION: z.string().optional().default("snappy"),
  CONSUMER_PROTOCOL: z.string().optional(),

  // Bulker Configuration
  BULKER_URL: z.string().optional(),
  BULKER_AUTH_KEY: z.string().optional(),

  // Application Configuration
  APPLICATION_ID: z.string().optional(),
  INSTANCE_ID: z.string().optional(),
  ROTOR_INSTANCE_ID: z.string().optional(),
  INSTANCE_INDEX: z.string().optional().default("0"),

  // Message Processing Configuration
  MESSAGES_RETRY_COUNT: z.string().optional().default("3"),
  MESSAGES_RETRY_BACKOFF_BASE: z.string().optional().default("10"),
  MESSAGES_RETRY_BACKOFF_MAX_DELAY: z.string().optional().default("1440"),
  CONCURRENCY: z.string().optional().default("10"),
  FETCH_TIMEOUT_MS: z.string().optional().default("2000"),

  // Metrics Configuration
  METRICS_DESTINATION_ID: z.string().optional(),

  // Functions Configuration
  FAST_STORE_WORKSPACE_ID: z.string().optional(),

  // Authentication Configuration
  ROTOR_AUTH_TOKENS: z.string().optional(),
  ROTOR_RAW_AUTH_TOKENS: z.string().optional(),

  // Shutdown Configuration
  SHUTDOWN_EXTRA_DELAY_SEC: z.string().optional().default("5"),

  // AWS/S3 Configuration (fallback for MaxMind)
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Diagnostics
  __DANGEROUS_ENABLE_FULL_DIAGNOSTICS: z.string().optional().default("false"),

  // Version/Build Information
  JITSU_VERSION_COMMIT_SHA: z.string().optional(),
  JITSU_VERSION_DOCKER_TAG: z.string().optional(),
  JITSU_VERSION_STRING: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),

  // Repository Configuration (used by @jitsu/core-functions)
  REPOSITORY_BASE_URL: z.string().optional(),
  REPOSITORY_AUTH_TOKEN: z.string().optional(),
  REPOSITORY_REFRESH_PERIOD_SEC: z.string().optional().default("2"),
  REPOSITORY_CACHE_DIR: z.string().optional(),

  // MongoDB Configuration
  MONGODB_URL: z.string().optional(),
  MONGODB_TIMEOUT_MS: z.string().optional().default("1000"),
  MONGODB_NETWORK_COMPRESSION: z.string().optional(),

  // UDF Configuration (used by @jitsu/core-functions)
  UDF_TIMEOUT_MS: z.string().optional().default("5000"),

  // Warehouse Configuration (used by @jitsu/core-functions)
  WAREHOUSE_TIMEOUT_MS: z.string().optional().default("1000"),

  // Fetch Configuration (used by @jitsu/core-functions)
  FETCH_FORBID_LOCAL: z.string().optional().default("false"),
  FETCH_LOCAL_WHITELIST: z.string().optional(),

  // Nango Configuration (used by @jitsu/core-functions)
  NANGO_APP_HOST: z.string().optional(),
  NANGO_API_HOST: z.string().optional(),
  NANGO_SECRET_KEY: z.string().optional(),
  NANGO_PUBLIC_KEY: z.string().optional(),
  NANGO_CALLBACK: z.string().optional(),
  NANGO_HOST: z.string().optional(),

  // Profile Builder's settings
  INSTANCES_COUNT: z.string().optional().default("1"),
  APP_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  KAFKA_TOPIC_PREFIX: z.string().optional().default(""),
  KAFKA_TOPIC_REPLICATION_FACTOR: z.string().optional().default("1"),
  KAFKA_TOPIC_RETENTION_HOURS: z.string().optional().default("48"),
  KAFKA_TOPIC_SEGMENT_HOURS: z.string().optional().default("24"),
  METRICS_INTERVAL_MS: z.string().optional().default("5000"),
  PRIORITY_LEVELS: z.string().optional().default("3"),

  // Functions Server settings
  CONFIG_DIR: z.string().optional().default("./data"),
  INIT_FILES: z
    .string()
    .optional()
    .transform(v => v === "true" || v === "1"),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let serverEnvCache: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (serverEnvCache) {
    return serverEnvCache;
  }
  const result = ServerEnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors: string[] = [];

    for (const issue of result.error.issues) {
      const field = issue.path.join(".");

      if (issue.code === "invalid_type") {
        if (issue.received === "undefined") {
          errors.push(`${field} - missing`);
        } else {
          errors.push(`${field} - expected ${issue.expected}, received ${issue.received}`);
        }
      } else {
        errors.push(`${field} - invalid format: ${issue.code} ${issue.message}`);
      }
    }

    throw new Error(`Following env vars are misconfigured:\n${errors.join("\n")}`);
  }
  serverEnvCache = result.data;
  return serverEnvCache;
}
