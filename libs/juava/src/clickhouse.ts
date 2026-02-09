export type ClickhouseConfig = {
  url: string;
  username: string;
  password: string;
  database?: string;
};

export type ClickhouseEnvVars = {
  CLICKHOUSE_URL?: string;
  CLICKHOUSE_HOST?: string;
  CLICKHOUSE_USERNAME?: string;
  CLICKHOUSE_PASSWORD?: string;
  CLICKHOUSE_DATABASE?: string;
  CLICKHOUSE_METRICS_SCHEMA?: string;
  CLICKHOUSE_SSL?: string | boolean;
};

/**
 * Parses a ClickHouse URL and extracts components.
 * URL format: [protocol://][username:password@]host[:port][/database]
 */
export function parseClickhouseUrl(url: string): {
  protocol?: string;
  username?: string;
  password?: string;
  host?: string;
  port?: string;
  database?: string;
} {
  const result: ReturnType<typeof parseClickhouseUrl> = {};

  let remaining = url;

  // Extract protocol if present
  const protocolMatch = remaining.match(/^(https?):\/\//);
  if (protocolMatch) {
    result.protocol = protocolMatch[1];
    remaining = remaining.slice(protocolMatch[0].length);
  }

  // Extract username:password if present (before @)
  const atIndex = remaining.indexOf("@");
  if (atIndex !== -1) {
    const credentials = remaining.slice(0, atIndex);
    remaining = remaining.slice(atIndex + 1);

    const colonIndex = credentials.indexOf(":");
    if (colonIndex !== -1) {
      result.username = decodeURIComponent(credentials.slice(0, colonIndex));
      result.password = decodeURIComponent(credentials.slice(colonIndex + 1));
    } else {
      result.username = decodeURIComponent(credentials);
    }
  }

  // Extract database if present (after /)
  const slashIndex = remaining.indexOf("/");
  if (slashIndex !== -1) {
    result.database = remaining.slice(slashIndex + 1).split("?")[0] || undefined;
    remaining = remaining.slice(0, slashIndex);
  }

  // Remaining is host[:port]
  if (remaining) {
    const colonIndex = remaining.lastIndexOf(":");
    if (colonIndex !== -1) {
      result.host = remaining.slice(0, colonIndex);
      result.port = remaining.slice(colonIndex + 1);
    } else {
      result.host = remaining;
    }
  }

  return result;
}

/**
 * Builds ClickHouse client configuration from environment variables.
 *
 * Priority:
 * 1. Parse CLICKHOUSE_URL for all components
 * 2. Fall back to individual env vars for missing components
 * 3. Use CLICKHOUSE_SSL to determine protocol if not in URL
 *
 * @param env - Environment variables object
 * @returns ClickHouse client configuration
 */
export function getClickhouseConfig(env: ClickhouseEnvVars): ClickhouseConfig {
  let protocol: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  let host: string | undefined;
  let port: string | undefined;
  let database: string | undefined;

  // Parse URL if provided
  if (env.CLICKHOUSE_URL) {
    const parsed = parseClickhouseUrl(env.CLICKHOUSE_URL);
    protocol = parsed.protocol;
    username = parsed.username;
    password = parsed.password;
    host = parsed.host;
    port = parsed.port;
    database = parsed.database;
  }

  // Fall back to individual env vars for missing components
  username = username ?? env.CLICKHOUSE_USERNAME ?? "default";
  password = password ?? env.CLICKHOUSE_PASSWORD ?? "";
  database = database ?? env.CLICKHOUSE_METRICS_SCHEMA ?? env.CLICKHOUSE_DATABASE ?? "newjitsu_metrics";

  // Determine protocol from CLICKHOUSE_SSL if not in URL
  if (!protocol) {
    const ssl = env.CLICKHOUSE_SSL;
    const useSsl = ssl === true || ssl === "true" || ssl === "1";
    protocol = useSsl ? "https" : "http";
  }

  // Fall back to CLICKHOUSE_HOST if host not in URL
  if (!host) {
    host = env.CLICKHOUSE_HOST;
  }

  if (!host) {
    throw new Error("ClickHouse host is required. Set CLICKHOUSE_URL or CLICKHOUSE_HOST");
  }

  // Build the URL
  const portSuffix = port ? `:${port}` : "";
  const url = `${protocol}://${host}${portSuffix}`;

  return {
    url,
    username,
    password,
    database,
  };
}
