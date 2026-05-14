import { Client } from "pg";
import prompts from "prompts";
import { getLog } from "juava";
import { spawn, spawnSync } from "node:child_process";
import { Transform } from "node:stream";
import { expandEnvPlaceholders } from "../utils/env.ts";
import { clientConfig, describe, envFor, parsePgUrl, type PgConn } from "../utils/pg-url.ts";

const log = getLog("copy-db");
const QUOTE = (id: string) => `"${id.replace(/"/g, '""')}"`;

/**
 * Tables whose schema is copied but whose rows are skipped by default. These
 * are large, dev-irrelevant logs/audits in the Jitsu schema; collectively
 * ~5 GiB out of ~5.5 GiB. Override with --all-tables.
 */
const STRUCTURE_ONLY_TABLES = [
  "betteruptime.events",
  "newjitsu.StatusChange",
  "newjitsu.AuditLog",
  "newjitsu.source_task",
];

type Options = { src: string; dst: string; cleanDst: boolean; allTables: boolean };

function parseArgs(args: string[]): Options {
  let src: string | undefined;
  let dst: string | undefined;
  let cleanDst = false;
  let allTables = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--src") src = args[++i];
    else if (a === "--dst") dst = args[++i];
    else if (a.startsWith("--src=")) src = a.slice("--src=".length);
    else if (a.startsWith("--dst=")) dst = a.slice("--dst=".length);
    else if (a === "--clean-dst") cleanDst = true;
    else if (a === "--all-tables") allTables = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!src) throw new Error("Missing --src URL");
  if (!dst) throw new Error("Missing --dst URL");
  return { src, dst, cleanDst, allTables };
}

function checkBinary(name: string): void {
  const r = spawnSync(name, ["--version"], { stdio: "ignore" });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(
      `${name} not found on PATH. Install postgres client tools (e.g. \`brew install libpq && brew link --force libpq\`).`
    );
  }
}

async function confirm(message: string, cleanDst: boolean): Promise<void> {
  if (cleanDst) return;
  log.atInfo().log(`Awaiting confirmation: ${message}`);
  const ans = await prompts({ type: "confirm", name: "ok", message, initial: false });
  if (!ans.ok) {
    log.atInfo().log("User declined; aborting.");
    process.exit(1);
  }
}

/**
 * Whole-DB clean: drop+recreate dst.database via the `postgres` maintenance
 * connection. Used when src has no schema scope (`?schema=*` or no
 * `?schema=`) and the user wants a full mirror. WITH (FORCE) terminates any
 * other sessions on the database.
 */
async function ensureFreshDatabase(dst: PgConn, cleanDst: boolean): Promise<void> {
  log.atInfo().log(`Connecting to maintenance DB postgres on ${dst.host}:${dst.port} as ${dst.user}...`);
  const admin = new Client(clientConfig(dst, "postgres"));
  await admin.connect();
  log.atInfo().log("Maintenance connection ok.");
  try {
    const r = await admin.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
      [dst.database]
    );
    if (r.rows[0].exists) {
      log.atInfo().log(`Database "${dst.database}" exists.`);
      await confirm(
        `Drop database "${dst.database}" on ${dst.host}:${dst.port} and replace with src? (pass --clean-dst to skip)`,
        cleanDst
      );
      log.atInfo().log(`Dropping database "${dst.database}" WITH (FORCE)...`);
      await admin.query(`DROP DATABASE ${QUOTE(dst.database)} WITH (FORCE)`);
      log.atInfo().log("Drop complete.");
    } else {
      log.atInfo().log(`Database "${dst.database}" does not exist.`);
    }
    log.atInfo().log(`Creating database "${dst.database}"...`);
    await admin.query(`CREATE DATABASE ${QUOTE(dst.database)}`);
    log.atInfo().log("Create complete.");
  } finally {
    await admin.end().catch(() => {});
  }
}

/**
 * Strip top-level `SET <param> = ...;` statements that newer pg_dump versions
 * emit but older dst servers reject. Targeted denylist — every other SET
 * (`row_security`, `check_function_bodies`, `search_path`, `xmloption`, etc.)
 * stays, since they matter for valid restores.
 *
 * Currently stripped:
 *   - `transaction_timeout`: pg_dump 17+ emits it; PG <17 errors out.
 *
 * Add new entries here only if you've actually seen a restore fail because of
 * the param.
 */
const STRIPPED_SET_PARAMS = new Set(["transaction_timeout"]);

function makeSetStripper(): Transform {
  let buf = "";
  function shouldDrop(line: string): boolean {
    const m = /^\s*SET\s+([A-Za-z_]+)\s*(=|TO)\s/i.exec(line);
    if (!m) return false;
    return STRIPPED_SET_PARAMS.has(m[1].toLowerCase());
  }
  return new Transform({
    transform(chunk, _enc, cb) {
      buf += chunk.toString("utf8");
      const out: string[] = [];
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl + 1);
        buf = buf.slice(nl + 1);
        if (!shouldDrop(line)) out.push(line);
        nl = buf.indexOf("\n");
      }
      cb(null, out.join(""));
    },
    flush(cb) {
      cb(null, shouldDrop(buf) ? "" : buf);
    },
  });
}

function fmtBytes(n: number): string {
  const mib = n / (1024 * 1024);
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GiB`;
  return `${mib.toFixed(1)} MiB`;
}

async function pgDumpToPsql(src: PgConn, dst: PgConn, structureOnly: string[]): Promise<void> {
  const dumpArgs = [
    "--no-owner",
    "--no-acl",
    "--no-comments",
    "--no-publications",
    "--no-subscriptions",
    "--quote-all-identifiers",
    // Skip every CREATE EXTENSION (the source server may have extensions
    // — plv8, vector, pg_stat_statements, etc. — that aren't installed on
    // dst). Object-level dependencies on those extensions either work via
    // built-ins or fail loudly later.
    "--exclude-extension=*",
  ];
  // Include the table's structure (CREATE TABLE + indexes) but omit its rows.
  for (const t of structureOnly) dumpArgs.push(`--exclude-table-data=${t}`);

  log.atInfo().log(`Spawning: pg_dump ${dumpArgs.join(" ")} (PGHOST=${src.host}, PGDATABASE=${src.database})`);
  const dump = spawn("pg_dump", dumpArgs, {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, ...envFor(src) },
  });
  log.atInfo().log(`Spawning: psql --quiet -v ON_ERROR_STOP=1 (PGHOST=${dst.host}, PGDATABASE=${dst.database})`);
  const psql = spawn("psql", ["--quiet", "--no-psqlrc", "-v", "ON_ERROR_STOP=1"], {
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, ...envFor(dst) },
  });

  // No reliable up-front estimate of text-dump size: TOAST is compressed
  // on disk and expands unpredictably (4–10× for jsonb-heavy tables) when
  // dumped. Just show throughput + elapsed time.
  let bytes = 0;
  let lastLoggedAt = 0;
  const startedAt = Date.now();
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      const now = Date.now();
      if (now - lastLoggedAt >= 5000) {
        const elapsedSec = (now - startedAt) / 1000;
        const mibps = bytes / (1024 * 1024) / Math.max(elapsedSec, 0.001);
        log.atInfo().log(`Streamed ${fmtBytes(bytes)} in ${elapsedSec.toFixed(0)}s (${mibps.toFixed(1)} MiB/s)`);
        lastLoggedAt = now;
      }
      cb(null, chunk);
    },
  });

  log.atInfo().log("Piping pg_dump → SET-stripper → byte-meter → psql...");
  // Swallow EPIPE: when psql dies on an error, pg_dump may still be writing.
  // We surface the actual cause via the exit codes below.
  const onPipeError = (where: string) => (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") {
      log.atWarn().log(`${where}: downstream closed; pg_dump output discarded`);
    } else {
      log.atError().log(`${where}: ${err.message}`);
    }
  };
  dump.stdout!.on("error", onPipeError("dump.stdout"));
  psql.stdin!.on("error", onPipeError("psql.stdin"));
  dump.stdout!.pipe(makeSetStripper()).pipe(meter).pipe(psql.stdin!);

  const dumpExit = new Promise<number>((resolve, reject) => {
    dump.on("error", reject);
    dump.on("exit", (code, signal) => {
      log.atInfo().log(`pg_dump exited (code=${code} signal=${signal ?? "-"})`);
      resolve(signal ? 128 : code ?? 0);
    });
  });
  const psqlExit = new Promise<number>((resolve, reject) => {
    psql.on("error", reject);
    psql.on("exit", (code, signal) => {
      log.atInfo().log(`psql exited (code=${code} signal=${signal ?? "-"})`);
      // If psql died non-zero, the pipeline is dead — kill pg_dump so we don't
      // wait forever on its stdout. SIGTERM gives it a chance to clean up.
      if ((code ?? 0) !== 0 && dump.exitCode === null) {
        log.atWarn().log("Sending SIGTERM to pg_dump (psql exited with error)");
        dump.kill("SIGTERM");
      }
      resolve(signal ? 128 : code ?? 0);
    });
  });
  const [dCode, pCode] = await Promise.all([dumpExit, psqlExit]);
  log.atInfo().log(`Total streamed: ${fmtBytes(bytes)}`);
  if (dCode !== 0) throw new Error(`pg_dump exited with code ${dCode}`);
  if (pCode !== 0) throw new Error(`psql exited with code ${pCode}`);
}

function isSameEndpoint(a: PgConn, b: PgConn): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

export async function runCopyDb(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const src = parsePgUrl(expandEnvPlaceholders(opts.src));
  const dst = parsePgUrl(expandEnvPlaceholders(opts.dst));

  log.atInfo().log(`src: ${describe(src)}`);
  log.atInfo().log(`dst: ${describe(dst)}`);

  // Refuse before anything destructive: dropping dst when src and dst point
  // at the same place would destroy the only copy.
  if (isSameEndpoint(src, dst)) {
    throw new Error(
      `src and dst point to the same endpoint (${describe(
        src
      )}). Refusing to continue — dropping dst would destroy src.`
    );
  }

  log.atInfo().log("Checking binaries on PATH...");
  checkBinary("pg_dump");
  checkBinary("psql");
  log.atInfo().log("pg_dump + psql ok.");

  await ensureFreshDatabase(dst, opts.cleanDst);

  const structureOnly = opts.allTables ? [] : STRUCTURE_ONLY_TABLES;
  if (structureOnly.length > 0) {
    log.atInfo().log(`Structure-only (no rows) for: ${structureOnly.join(", ")} — pass --all-tables to include data.`);
  } else if (opts.allTables) {
    log.atInfo().log("--all-tables: every table's data will be copied.");
  }

  const t0 = Date.now();
  await pgDumpToPsql(src, dst, structureOnly);
  log.atInfo().log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}
