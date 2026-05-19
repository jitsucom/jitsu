import type { ClientConfig } from "pg";

/**
 * Parsed Postgres connection. We always go through this struct rather than
 * passing the raw URL around — subprocesses (pg_dump, psql) get their
 * connection via PG* env vars instead of a URL string.
 *
 * Any `?schema=` in the URL is intentionally ignored: copy-db always mirrors
 * the entire database. Single-schema copies tend to break on cross-schema
 * references and aren't worth the foot-guns.
 */
export type PgConn = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslmode: string | null;
};

export function parsePgUrl(url: string): PgConn {
  const u = new URL(url);
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") {
    throw new Error(`Unsupported protocol: ${u.protocol} (expected postgres:// or postgresql://)`);
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!database) throw new Error(`Missing database name in URL: ${url}`);

  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    sslmode: u.searchParams.get("sslmode"),
  };
}

export function describe(c: PgConn): string {
  return `${c.host}:${c.port}/${c.database} (user=${c.user})`;
}

/** Build a pg-client config; optional dbOverride lets us connect to `postgres` for admin work. */
export function clientConfig(c: PgConn, dbOverride?: string): ClientConfig {
  let ssl: ClientConfig["ssl"] = false;
  if (c.sslmode === "require" || c.sslmode === "prefer") ssl = { rejectUnauthorized: false };
  else if (c.sslmode === "verify-ca" || c.sslmode === "verify-full") ssl = { rejectUnauthorized: true };
  else if (c.sslmode === "no-verify") ssl = { rejectUnauthorized: false };
  return {
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: dbOverride ?? c.database,
    ssl,
  };
}

/** Build PG* env vars for pg_dump/psql; never include the URL itself. */
export function envFor(c: PgConn): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PGHOST: c.host,
    PGPORT: String(c.port),
    PGUSER: c.user,
    PGPASSWORD: c.password,
    PGDATABASE: c.database,
  };
  if (c.sslmode) {
    // libpq accepts: disable | allow | prefer | require | verify-ca | verify-full.
    // "no-verify" is a node-postgres-only extension; map it to libpq's
    // closest equivalent ("require" = TLS without cert verification).
    env.PGSSLMODE = c.sslmode === "no-verify" ? "require" : c.sslmode;
  }
  return env;
}
