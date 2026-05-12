import { z } from "zod";
import { ClientEnvSchema, getClientEnv, isBuilding, wrapZodError } from "../shared/clientEnv";
import { isTruish } from "juava";

/**
 * Server-side environment variables schema.
 * Extends client environment variables since NEXT_PUBLIC_* vars are also available on server.
 * Contains sensitive configuration that should NEVER be exposed to the browser.
 */
const ServerEnvSchema = ClientEnvSchema.extend({
  // ============================================
  // Database & Data Storage
  // ============================================

  // PostgreSQL connection string for main database (required)
  DATABASE_URL: z.string(),

  // Optional separate database for application data (falls back to DATABASE_URL)
  APP_DATABASE_URL: z.string().optional(),

  // Enable database query debugging - logs all SQL queries to console
  CONSOLE_DATABASE_DEBUG: z.string().default("false").transform(isTruish),

  // ============================================
  // ClickHouse Configuration
  // ============================================

  // ClickHouse connection URL (preferred over individual settings)
  CLICKHOUSE_URL: z.string().optional(),

  // ClickHouse hostname (fallback if CLICKHOUSE_URL not set)
  CLICKHOUSE_HOST: z.string().optional(),

  // Enable SSL for ClickHouse connection
  CLICKHOUSE_SSL: z.string().default("false").transform(isTruish),

  // ClickHouse authentication username
  CLICKHOUSE_USERNAME: z.string().optional().default("default"),

  // ClickHouse authentication password
  CLICKHOUSE_PASSWORD: z.string().optional().default(""),

  // Main ClickHouse database name for events and analytics data
  CLICKHOUSE_DATABASE: z.string().optional().default("newjitsu_metrics"),

  // Metrics schema name (falls back to CLICKHOUSE_DATABASE)
  CLICKHOUSE_METRICS_SCHEMA: z.string().optional().default("newjitsu_metrics"),

  // ClickHouse cluster identifier for distributed queries
  CLICKHOUSE_CLUSTER: z.string().optional(),

  // Metrics cluster identifier (falls back to CLICKHOUSE_CLUSTER)
  CLICKHOUSE_METRICS_CLUSTER: z.string().optional(),

  // ============================================
  // Sync Engine (Syncctl)
  // ============================================

  // Syncctl service endpoint URL
  SYNCCTL_URL: z.string().optional(),

  //k8s injected variables, can be used instead sync URL
  SYNCCTL_PORT: z.coerce.number().optional(),
  SYNCCTL_SERVICE_HOST: z.string().optional(),

  // Authentication key for syncctl API calls
  SYNCCTL_AUTH_KEY: z.string().optional(),

  // Enable/disable syncs feature globally
  SYNCS_ENABLED: z.string().default("false").transform(isTruish),

  // Sync task log retention age in days
  SYNC_TASK_LOG_AGE: z.coerce.number().optional().default(60),

  // Maximum sync task log size
  SYNC_TASK_LOG_SIZE: z.coerce.number().optional().default(3000),

  // Enable debug mode for sync operations
  DEBUG_SYNCS: z.string().default("false").transform(isTruish),

  // ============================================
  // Google Cloud Services
  // ============================================

  // Google Cloud Scheduler service account key (JSON)
  GOOGLE_SCHEDULER_KEY: z.string().optional(),

  // Google Cloud region for scheduler
  GOOGLE_SCHEDULER_LOCATION: z.string().optional().default("us-central1"),

  // ============================================
  // Authentication & OAuth
  // ============================================

  // GitHub OAuth application client ID
  GITHUB_CLIENT_ID: z.string().optional(),

  // GitHub OAuth application client secret
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Google OAuth application client ID
  GOOGLE_CLIENT_ID: z.string().optional(),

  // Google Ads API developer token
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),

  // JWT signing secret for NextAuth sessions (required)
  JWT_SECRET: z.string(),

  // NextAuth callback URL (auto-detected in most cases)
  NEXTAUTH_URL: z.string().optional(),

  // Cookie domain for the NextAuth session cookie.
  //   - When set (e.g. `.jitsu.localhost`), `Set-Cookie` carries `Domain=...` and the
  //     browser sends the cookie to every host that domain-matches the value — useful
  //     for sharing the dev session across `console.jitsu.localhost`,
  //     `ee.jitsu.localhost`, and `console-$BRANCH_NAME.jitsu.localhost`.
  //   - When unset, `Set-Cookie` omits `Domain=`. Per RFC 6265 the browser then makes
  //     the cookie host-only, scoped to whatever hostname served the response (taken
  //     from the request's Host header — no code-side input needed). This is the right
  //     behaviour in production (e.g. `use.jitsu.com`), so leave it unset there.
  AUTH_COOKIE_DOMAIN: z.string().optional(),

  // Public URL of Jitsu console
  JITSU_PUBLIC_URL: z.string().optional(),
  JITSU_PUBLIC: z.string().optional(), // Alias for JITSU_PUBLIC_URL

  // OIDC provider configuration (JSON format)
  AUTH_OIDC_PROVIDER: z.string().optional(),

  // Enable dynamic OIDC provider support
  DYNAMIC_OIDC_ENABLED: z.string().default("false").transform(isTruish),

  // Enable email/password login
  ENABLE_CREDENTIALS_LOGIN: z.string().default("false").transform(isTruish),

  // Firebase authentication configuration (JSON)
  FIREBASE_AUTH: z.string().optional(),

  // Firebase admin SDK configuration (JSON)
  FIREBASE_ADMIN: z.string().optional(),

  // Firebase client-side configuration (JSON)
  FIREBASE_CLIENT_CONFIG: z.string().optional(),

  // ============================================
  // OAuth Integration Services (Nango)
  // ============================================

  // Nango integration platform host URL
  NANGO_APP_HOST: z.string().optional(),

  // Nango API host URL (required for Nango integration)
  NANGO_API_HOST: z.string().optional(),

  // Nango secret key for authentication
  NANGO_SECRET_KEY: z.string().optional(),

  // Nango public key
  NANGO_PUBLIC_KEY: z.string().optional(),

  // Nango OAuth callback URL
  NANGO_CALLBACK: z.string().optional(),

  // Nango host (used to construct callback URL)
  NANGO_HOST: z.string().optional(),

  // ============================================
  // Data Ingestion & Processing
  // ============================================

  // Public URL for event ingestion API
  JITSU_INGEST_PUBLIC_URL: z.string().optional(),

  // Bulker (data warehouse connector) service URL
  BULKER_URL: z.string().optional(),

  //k8s injected variables, can be used instead bulker URL
  BULKER_PORT: z.coerce.number().optional(),
  BULKER_SERVICE_HOST: z.string().optional(),

  // Authentication key for bulker API
  BULKER_AUTH_KEY: z.string().optional(),

  // Rotor service endpoint for profile/function execution
  ROTOR_URL: z.string().optional(),
  //k8s injected variables, can be used instead rotor URL
  ROTOR_PORT: z.coerce.number().optional(),
  ROTOR_SERVICE_HOST: z.string().optional(),

  // Authentication key for rotor API
  ROTOR_AUTH_KEY: z.string().optional(),

  // Functions server URL template (use ${workspaceId} as placeholder)
  FUNCTIONS_SERVER_URL_TEMPLATE: z.string().default("http://fs-${workspaceId}:3456"),

  // Default functions class when workspace has no explicit setting
  DEFAULT_FUNCTIONS_CLASS: z.string().optional().default("free"),

  // ============================================
  // Email Configuration
  // ============================================

  // SMTP server connection string (format: host:port:user:password)
  SMTP_CONNECTION_STRING: z.string().optional(),

  // From email address for transactional emails
  EMAIL_TRANSACTIONAL_SENDER: z.string().optional(),

  // Reply-to email address for transactional emails
  EMAIL_TRANSACTIONAL_REPLY_TO: z.string().optional(),

  // ============================================
  // Admin & Management
  // ============================================

  // Admin email for system notifications
  ADMIN_EMAIL: z.string().optional(),

  // Comma-separated list of auth tokens for API access
  CONSOLE_AUTH_TOKENS: z.string().optional(),

  // Raw auth tokens (alternative to hashed tokens)
  CONSOLE_RAW_AUTH_TOKENS: z.string().optional(),

  // One-time initialization token (set to undefined after use)
  CONSOLE_INIT_TOKEN: z.string().optional(),

  // Secret for hashing console tokens (falls back to GLOBAL_HASH_SECRET)
  CONSOLE_TOKEN_SECRET: z.string().optional(),

  // Global secret for hashing operations
  GLOBAL_HASH_SECRET: z.string().optional(),

  // Enable audit logging for security and compliance
  CONSOLE_ENABLE_AUDIT_LOG: z.string().default("false").transform(isTruish),

  // ============================================
  // Features & Flags
  // ============================================

  // Disable new user registration
  DISABLE_SIGNUP: z.string().default("false").transform(isTruish),

  // Enable MIT-compliant mode (disables proprietary features)
  MIT_COMPLIANT: z.string().default("false").transform(isTruish),

  // Connection string for Enterprise Edition features
  EE_CONNECTION: z.string().optional(),

  // ============================================
  // Logging & Debugging
  // ============================================

  // Server-side log level (debug, info, warn, error)
  LOG_LEVEL: z.string().optional().default("info"),

  // Frontend log level (falls back to LOG_LEVEL)
  FRONTEND_LOG_LEVEL: z.string().optional(),

  // Disable ANSI color codes in server logs
  DISABLE_SERVER_LOGS_ANSI_COLORING: z.string().default("false").transform(isTruish),

  // Log format ("json" for structured JSON logs, "text" for plain text)
  LOG_FORMAT: z.string().optional(),

  // ============================================
  // Telemetry
  // ============================================

  // Disable anonymous usage telemetry
  JITSU_DISABLE_ANONYMOUS_TELEMETRY: z.string().default("false").transform(isTruish),

  // Custom telemetry API key (overrides default)
  JITSU_SERVER_ANONYMOUS_TELEMETRY_KEY: z.string().optional(),

  // Product telemetry backend host (Jitsu Cloud only)
  JITSU_PRODUCT_TELEMETRY_HOST: z.string().optional(),

  // Write key for product telemetry
  JITSU_PRODUCT_BACKEND_TELEMETRY_WRITE_KEY: z.string().optional(),

  // ============================================
  // Seeding & Demo
  // ============================================

  // Demo/seed user email for initial setup
  SEED_USER_EMAIL: z.string().optional(),

  // Demo/seed user password for initial setup
  SEED_USER_PASSWORD: z.string().optional(),

  // Enable seeding of demo configuration
  SEED_DEMO_CONFIGURATION: z.string().default("false").transform(isTruish),

  // Schema for demo destination
  DEMO_DESTINATION_SCHEMA: z.string().optional().default("jitsu-data"),

  // ============================================
  // Version & Infrastructure
  // ============================================

  // Git commit SHA for current version
  JITSU_VERSION_COMMIT_SHA: z.string().optional(),

  // Docker tag/version stream
  JITSU_VERSION_DOCKER_TAG: z.string().optional(),

  // Full version string
  JITSU_VERSION_STRING: z.string().optional(),

  // Vercel deployment git commit SHA
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),

  // Vercel deployment URL
  VERCEL_URL: z.string().optional(),

  // Flag indicating running on Vercel platform
  VERCEL: z.string().default("false").transform(isTruish),

  // Node environment (development/production/test)
  NODE_ENV: z.string().optional().default("development"),

  // Hostname for telemetry reporting
  HOST: z.string().optional(),

  // ============================================
  // Custom Domains & Infrastructure
  // ============================================

  // Comma-separated list of allowed CNAME values for custom domains
  CUSTOM_DOMAIN_CNAMES: z.string().optional(),

  // Ingestion manager service URL
  INGMGR_URL: z.string().optional(),

  //k8s injected variables, can be used instead ingmgr URL
  INGMGR_PORT: z.coerce.number().optional(),
  INGMGR_SERVICE_HOST: z.string().optional(),

  // Authentication key for ingestion manager
  INGMGR_AUTH_KEY: z.string().optional(),

  // Default CNAME for custom domains
  CNAME: z.string().optional().default("cname.jitsu.com"),

  // ============================================
  // Miscellaneous Settings
  // ============================================

  // CORS allowed origins pattern
  ALLOWED_API_ORIGINS: z.string().optional(),

  // Comma-separated list of data domains
  DATA_DOMAIN: z.string().optional(),

  // ISO date string for read-only mode expiration
  JITSU_CONSOLE_READ_ONLY_UNTIL: z.string().optional(),

  // Documentation website URL
  JITSU_DOCUMENTATION_URL: z.string().optional().default("https://docs.jitsu.com/"),

  // ClickHouse events log size limit
  EVENTS_LOG_SIZE: z.coerce.number().optional().default(200000),

  // Slack webhook URL for notifications
  SLACK_WEBHOOK_URL: z.string().optional(),

  // Enable full environment diagnostics (dangerous - exposes all env vars!)
  __DANGEROUS_ENABLE_FULL_DIAGNOSTICS: z.coerce.boolean().default(false),

  // ============================================
  // API Rate Limiting (per-minute, sliding window)
  // ============================================

  // Master kill switch. Set to "false" to disable rate limiting entirely.
  MINUTE_RATE_LIMIT_ENABLED: z.string().default("true").transform(isTruish),

  // Base per-minute budget. All (auth class × HTTP method) limits derive
  // from this number via fixed multipliers (see MULTIPLIERS in
  // lib/server/rate-limit/config.ts) unless overridden by a specific
  // MINUTE_RATE_LIMIT_<AUTH>_<METHOD> var below or by a per-route override.
  // e.g. base=60 → bearer GET=600 (×10), bearer POST=120 (×2), session GET=1200 (×20).
  MINUTE_RATE_LIMIT_BASE: z.coerce.number().optional().default(60),

  // Explicit per-cell overrides. Leave unset to use base × multiplier.
  MINUTE_RATE_LIMIT_BEARER_GET: z.coerce.number().optional(),
  MINUTE_RATE_LIMIT_BEARER_POST: z.coerce.number().optional(),
  MINUTE_RATE_LIMIT_BEARER_PUT: z.coerce.number().optional(),
  MINUTE_RATE_LIMIT_BEARER_PATCH: z.coerce.number().optional(),
  MINUTE_RATE_LIMIT_BEARER_DELETE: z.coerce.number().optional(),
  MINUTE_RATE_LIMIT_SESSION_GET: z.coerce.number().optional(),
  MINUTE_RATE_LIMIT_SESSION_POST: z.coerce.number().optional(),
  MINUTE_RATE_LIMIT_SESSION_PUT: z.coerce.number().optional(),
  MINUTE_RATE_LIMIT_SESSION_PATCH: z.coerce.number().optional(),
  MINUTE_RATE_LIMIT_SESSION_DELETE: z.coerce.number().optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let serverEnvCache: ServerEnv | undefined;

/**
 * Gets validated server environment variables.
 * Includes all client environment variables plus server-only configuration.
 * This function caches the result to avoid repeated validation.
 */
export function getServerEnv(): ServerEnv {
  if (isBuilding()) {
    //bogus env
    return {} as ServerEnv;
  }
  // check is in browser context
  if (typeof window !== "undefined" && typeof window.document !== "undefined") {
    return getClientEnv() as unknown as ServerEnv;
  }
  if (serverEnvCache) {
    return serverEnvCache;
  }

  const result = ServerEnvSchema.safeParse(process.env);

  if (!result.success) {
    throw wrapZodError(result);
  }

  if (!result.data.BULKER_URL && result.data.BULKER_PORT && result.data.BULKER_SERVICE_HOST) {
    result.data.BULKER_URL = `http://${result.data.BULKER_SERVICE_HOST}:${result.data.BULKER_PORT}`;
  }

  if (!result.data.ROTOR_URL && result.data.ROTOR_PORT && result.data.ROTOR_SERVICE_HOST) {
    result.data.ROTOR_URL = `http://${result.data.ROTOR_SERVICE_HOST}:${result.data.ROTOR_PORT}`;
  }

  if (!result.data.SYNCCTL_URL && result.data.SYNCCTL_PORT && result.data.SYNCCTL_SERVICE_HOST) {
    result.data.SYNCCTL_URL = `http://${result.data.SYNCCTL_SERVICE_HOST}:${result.data.SYNCCTL_PORT}`;
  }

  if (!result.data.INGMGR_URL && result.data.INGMGR_PORT && result.data.INGMGR_SERVICE_HOST) {
    result.data.INGMGR_URL = `http://${result.data.INGMGR_SERVICE_HOST}:${result.data.INGMGR_PORT}`;
  }

  serverEnvCache = result.data;
  return serverEnvCache;
}
