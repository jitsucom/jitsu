import type { ClickHouseClient } from "@clickhouse/client";
import { getServerLog } from "./log";
// Raw SQL templates (loaded as strings via raw-loader in Next / the raw-sql
// plugin in vitest). These are the single source of truth for the ClickHouse
// DDL — do not duplicate the statements here.
import eventsLogSqlTemplate from "../../prisma/events_log.clickhouse.sql";
import metricsSqlTemplate from "../../prisma/metrics.clickhouse.sql";

const log = getServerLog("clickhouse-init");

export interface ClickhouseInitOptions {
  clickhouse: ClickHouseClient;
  /** Target database (aka metrics schema), e.g. `newjitsu_metrics`. */
  database: string;
  /** ClickHouse cluster name — omitted on single-node installations (and in tests). */
  cluster?: string | undefined;
  /** Credentials embedded into the cutoff dictionary's SOURCE clause. */
  username: string;
  password: string;
}

/** @deprecated use {@link ClickhouseInitOptions}. Kept for backwards compatibility. */
export type EventsLogInitOptions = ClickhouseInitOptions;

interface TemplateVars {
  db: string;
  cluster?: string | undefined;
  username: string;
  password: string;
}

interface PreparedStatement {
  sql: string;
  /** Per-statement ClickHouse settings, from a `-- @ch-settings` directive. */
  settings?: Record<string, number>;
}

// Escape single quotes for values interpolated into single-quoted SQL literals.
// The values come from trusted config, not user input. Note the rendered DDL —
// including the dictionary credentials — is visible in ClickHouse query logs
// and SHOW CREATE; a named collection is the follow-up to remove that exposure.
const sqlLit = (s: string): string => s.replace(/'/g, "''");

/**
 * Resolve the template placeholders for one rendering target:
 *   ${onCluster}            -> " ON CLUSTER `<cluster>`" (cluster) or "" (single-node)
 *   ${engine:Family:znode}  -> Replicated<Family>(znode path) (cluster) or <Family>() (single-node)
 *   ${user} / ${password}   -> escaped credentials
 *   ${db}                   -> target database
 */
function renderTemplate(fragment: string, vars: TemplateVars): string {
  const onCluster = vars.cluster ? ` ON CLUSTER \`${vars.cluster}\`` : "";
  return fragment
    .replace(/\$\{onCluster\}/g, onCluster)
    .replace(/\$\{engine:([A-Za-z]+):([A-Za-z0-9_]+)\}/g, (_m, family: string, znode: string) =>
      vars.cluster
        ? `Replicated${family}('/clickhouse/tables/{shard}/${vars.db}/${znode}', '{replica}')`
        : `${family}()`
    )
    .replace(/\$\{user\}/g, sqlLit(vars.username))
    .replace(/\$\{password\}/g, sqlLit(vars.password))
    .replace(/\$\{db\}/g, vars.db);
}

/**
 * Split a `.clickhouse.sql` template into executable statements. Line comments
 * (`-- ...`) are stripped; statements are separated by `;`. A directive line
 * `-- @ch-settings k=v, k2=v2` attaches those settings to the next statement.
 * The templates keep `;` out of statement bodies, so a naive top-level split is
 * safe (no string/paren-aware parsing needed).
 */
function prepareStatements(template: string, vars: TemplateVars): PreparedStatement[] {
  const statements: PreparedStatement[] = [];
  let buffer = "";
  let pendingSettings: Record<string, number> | undefined;
  let currentSettings: Record<string, number> | undefined;

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) {
      statements.push({ sql: renderTemplate(trimmed, vars), settings: currentSettings });
    }
    buffer = "";
    currentSettings = undefined;
  };

  for (const rawLine of template.split("\n")) {
    const directive = rawLine.match(/^\s*--\s*@ch-settings\s+(.+)$/);
    if (directive) {
      pendingSettings = pendingSettings ?? {};
      for (const pair of directive[1].split(",")) {
        const [k, v] = pair.split("=").map(s => s.trim());
        if (k) pendingSettings[k] = Number(v);
      }
      continue;
    }
    const line = rawLine.replace(/--.*$/, ""); // strip ordinary line comments
    if (buffer.trim() === "" && line.trim() === "") {
      continue; // blank space between statements
    }
    if (buffer.trim() === "") {
      // starting a new statement: latch any pending settings onto it
      currentSettings = pendingSettings;
      pendingSettings = undefined;
    }
    buffer += (buffer ? "\n" : "") + line;
    if (line.includes(";")) {
      const semi = buffer.lastIndexOf(";");
      const rest = buffer.slice(semi + 1);
      buffer = buffer.slice(0, semi);
      flush();
      buffer = rest;
    }
  }
  flush();
  return statements;
}

function describeStatement(sql: string): string {
  const firstLine = (sql.trim().split("\n")[0] ?? "").trim();
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
}

async function ensureDatabase(opts: ClickhouseInitOptions): Promise<void> {
  const onCluster = opts.cluster ? ` ON CLUSTER \`${opts.cluster}\`` : "";
  try {
    await opts.clickhouse.command({ query: `create database IF NOT EXISTS ${opts.database}${onCluster}` });
    log.atInfo().log(`Database ${opts.database} created or already exists`);
  } catch (e: any) {
    log.atError().withCause(e).log(`Failed to create ${opts.database} database.`);
    throw new Error(`Failed to create ${opts.database} database.`);
  }
}

/**
 * Render a template against the init target and run every statement, one per
 * object. Failures are accumulated (so one bad object doesn't hide the rest)
 * and rethrown as a single combined error at the end.
 */
async function applyTemplate(opts: ClickhouseInitOptions, template: string): Promise<void> {
  const statements = prepareStatements(template, {
    db: opts.database,
    cluster: opts.cluster,
    username: opts.username,
    password: opts.password,
  });
  const errors: Error[] = [];
  for (const { sql, settings } of statements) {
    const label = describeStatement(sql);
    try {
      await opts.clickhouse.command({
        query: sql,
        ...(settings ? { clickhouse_settings: settings as any } : {}),
      });
      log.atInfo().log(`Applied: ${label}`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed: ${label}`);
      errors.push(new Error(`${label}: ${e?.message ?? e}`));
    }
  }
  if (errors.length > 0) {
    throw new Error("Failed to initialize tables: " + errors.map(e => e.message).join("; "));
  }
}

/**
 * Create the events-log ClickHouse objects: the database, the `events_log` /
 * `task_log` / `dead_letter` tables, and the events_log retention machinery
 * (cutoff tables + dictionary + dictGet-driven TTL). The DDL lives in
 * `prisma/events_log.clickhouse.sql`; this renders it for the target (cluster
 * vs single-node, injected credentials) and executes it. Used by the
 * `admin/events-log-init` route against the prod cluster and by the test
 * harness against a per-test-file database — one source for the DDL.
 *
 * Throws when the database can't be created; accumulates per-object failures
 * and throws a combined error at the end otherwise.
 */
export async function initEventsLogTables(opts: ClickhouseInitOptions): Promise<void> {
  await ensureDatabase(opts);
  await applyTemplate(opts, eventsLogSqlTemplate);
}

/**
 * Create the metrics ClickHouse objects: the per-minute event `metrics`
 * aggregation (`metrics` -> `to_mv_metrics` -> `mv_metrics`) and the
 * active-users pipeline (`active_incoming` -> `mv_active_incoming2/3` ->
 * `active_incoming_agg` -> `active_incoming_agg_view`). The DDL lives in
 * `prisma/metrics.clickhouse.sql`; statements are ordered dependencies-first so
 * they can be applied top to bottom.
 *
 * Throws when the database can't be created; accumulates per-object failures
 * and throws a combined error at the end otherwise.
 */
export async function initMetricsTables(opts: ClickhouseInitOptions): Promise<void> {
  await ensureDatabase(opts);
  await applyTemplate(opts, metricsSqlTemplate);
}
