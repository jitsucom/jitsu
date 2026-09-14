/* eslint-disable no-restricted-properties -- runs in the vitest main process,
   outside the app; reads the reuse flag and passes env to the prisma CLI. */
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";
import { Client } from "pg";
import { createClient } from "@clickhouse/client";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { TestProject } from "vitest/node";

// Runs once per `vitest run` (only for the "integration" project): boots Postgres and
// ClickHouse containers, pushes the prisma schema into a sealed template
// database, and hands connection URLs to the worker forks via provide/inject.
// Each test file then clones the template into its own database (see setup.ts).
//
// CONSOLE_TEST_CONTAINERS_REUSE=1 keeps the containers running between local
// runs (testcontainers reuse): the next run connects in ~1s instead of paying
// the ~25s boot + `prisma db push`. The template is keyed by a hash of
// schema.prisma, so a schema change rebuilds it. Trade-off: the containers
// stay up until you `docker rm -f` them. See CONTRIBUTING.md.

const REUSE = process.env.CONSOLE_TEST_CONTAINERS_REUSE === "1";

const PG_IMAGE = "postgres:18-alpine"; // prod runs CNPG 18.x
// Same image + flags as services/rotor tests — matches prod 25.4.x and reuses the CI image cache.
const CH_IMAGE = "clickhouse/clickhouse-server:25.4-alpine";

function templateDbName(root: string): string {
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"));
  return `console_tpl_${createHash("sha256").update(schema).digest("hex").slice(0, 8)}`;
}

export default async function setup(project: TestProject) {
  const root = project.config.root;
  const templateDb = templateDbName(root);

  let pgContainer = new GenericContainer(PG_IMAGE)
    .withEnvironment({ POSTGRES_USER: "jitsu", POSTGRES_PASSWORD: "jitsu", POSTGRES_DB: "postgres" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(120_000);
  let chContainer = new GenericContainer(CH_IMAGE)
    .withExposedPorts(8123)
    .withEnvironment({
      CLICKHOUSE_DB: "default",
      CLICKHOUSE_USER: "default",
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1",
      CLICKHOUSE_SKIP_USER_SETUP: "1",
    })
    .withWaitStrategy(Wait.forHttp("/ping", 8123).forStatusCode(200))
    .withStartupTimeout(120_000);
  if (REUSE) {
    pgContainer = pgContainer.withReuse();
    chContainer = chContainer.withReuse();
  }

  const [pg, ch]: StartedTestContainer[] = await Promise.all([pgContainer.start(), chContainer.start()]);

  const pgUrlBase = `postgres://jitsu:jitsu@${pg.getHost()}:${pg.getMappedPort(5432)}`;
  const pgAdminUrl = `${pgUrlBase}/postgres`;
  const chUrl = `http://${ch.getHost()}:${ch.getMappedPort(8123)}`;

  const admin = new Client({ connectionString: pgAdminUrl });
  await admin.connect();
  try {
    if (REUSE) {
      await sweepStaleDatabases(admin, chUrl, templateDb);
    }
    const exists = await admin.query(`select 1 from pg_database where datname = $1`, [templateDb]);
    if (exists.rowCount === 0) {
      await admin.query(`create database "${templateDb}"`);
      // prisma has no supported programmatic API for `db push` — spawn the CLI,
      // resolved through the module system (no .bin or node_modules hardcodes).
      const require = createRequire(import.meta.url);
      execFileSync(
        process.execPath,
        [
          require.resolve("prisma/build/index.js"),
          "db",
          "push",
          "--skip-generate",
          `--schema=${path.join(root, "prisma/schema.prisma")}`,
        ],
        {
          env: { ...process.env, DATABASE_URL: `${pgUrlBase}/${templateDb}?schema=newjitsu` },
          stdio: "inherit",
        }
      );
      // Seal the template: CREATE DATABASE ... TEMPLATE requires zero live connections.
      await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [templateDb]);
      await admin.query(`alter database "${templateDb}" with is_template true allow_connections false`);
    }
  } finally {
    await admin.end();
  }

  project.provide("pgUrlBase", pgUrlBase);
  project.provide("pgAdminUrl", pgAdminUrl);
  project.provide("pgTemplateDb", templateDb);
  project.provide("chUrl", chUrl);

  return async () => {
    if (!REUSE) {
      await Promise.all([pg.stop(), ch.stop()]);
    }
  };
}

// Reused containers accumulate per-file databases across runs (each ~the size
// of the schema). Drop leftovers from previous runs, plus templates built from
// older schema.prisma versions.
async function sweepStaleDatabases(admin: Client, chUrl: string, currentTemplate: string) {
  const stale = await admin.query(
    `select datname, datistemplate from pg_database
      where (datname like 'console_t%' and datname != $1)`,
    [currentTemplate]
  );
  for (const row of stale.rows) {
    try {
      if (row.datistemplate) {
        await admin.query(`alter database "${row.datname}" with is_template false`);
      }
      await admin.query(`drop database "${row.datname}" with (force)`);
    } catch (e) {
      console.warn(`test-harness: failed to drop stale database ${row.datname}: ${e}`);
    }
  }
  const chAdmin = createClient({ url: chUrl });
  try {
    const rs = await chAdmin.query({
      query: `select name from system.databases where name like 'metrics_t%'`,
      format: "JSONEachRow",
    });
    for (const row of (await rs.json()) as { name: string }[]) {
      await chAdmin.command({ query: `drop database if exists "${row.name}"` });
    }
  } catch (e) {
    console.warn(`test-harness: ClickHouse stale-database sweep failed: ${e}`);
  } finally {
    await chAdmin.close();
  }
}
