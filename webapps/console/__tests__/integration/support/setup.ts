/* eslint-disable no-restricted-properties -- this file's job is to WRITE the
   baseline process.env before lib/server modules (serverEnv included) load;
   it cannot go through serverEnv. */
import { afterAll, afterEach, inject } from "vitest";
import { Client } from "pg";
import { createClient } from "@clickhouse/client";
import { randomBytes } from "node:crypto";
import { server, passthroughPrefixes, startMsw } from "./msw";

// Per-test-file setup. Runs in the worker fork BEFORE the test file's module
// graph is imported — that ordering is what makes the harness work: lib/server
// modules snapshot env and build singletons at import time (db.ts freezes
// DATABASE_URL into `global["singletons_*"]` on first import, clickhouse.ts
// builds its client from serverEnv), so everything below must be in place
// before any test file import of lib/** evaluates.
//
// IMPORTANT: no static lib/** imports in this file (the dynamic import below
// runs after the env baseline is set, which is safe).
//
// Isolation model: vitest's forks pool with isolate:true gives every test file
// its own process. This file claims a fresh Postgres database (cloned from the
// template built in global-setup.ts) and a fresh ClickHouse database for that
// process; the env assignments die with the fork, so nothing leaks between
// files. Per-test env overrides inside a file use vi.stubEnv (auto-restored via
// unstubEnvs:true in vitest.config.ts).

const runId = "t" + randomBytes(6).toString("hex");
const pgUrlBase = inject("pgUrlBase");
const chUrl = inject("chUrl");
const pgDb = `console_${runId}`;
const chDb = `metrics_${runId}`;

// A fresh fork has no singletons, but be defensive about juava's global cache.
for (const key of Object.keys(global).filter(k => k.startsWith("singletons_"))) {
  delete (global as any)[key];
}

// Claim Postgres: clone the sealed template (~100–200ms). The advisory lock
// serializes concurrent CREATE DATABASE ... TEMPLATE across parallel forks.
{
  const admin = new Client({ connectionString: inject("pgAdminUrl") });
  await admin.connect();
  try {
    await admin.query("select pg_advisory_lock(4290)");
    try {
      await admin.query(`create database "${pgDb}" template "${inject("pgTemplateDb")}"`);
    } finally {
      await admin.query("select pg_advisory_unlock(4290)");
    }
  } finally {
    await admin.end();
  }
}

// Baseline env. Everything a module-level getServerEnv() snapshot may read must
// be correct here; call-time readers can additionally be overridden per test
// with vi.stubEnv (getServerEnv re-parses per call under vitest — see the
// VITEST check in lib/server/serverEnv.ts).
process.env.DATABASE_URL = `${pgUrlBase}/${pgDb}?schema=newjitsu`;
process.env.CLICKHOUSE_URL = chUrl;
process.env.CLICKHOUSE_DATABASE = chDb;
process.env.CLICKHOUSE_METRICS_SCHEMA = chDb; // getClickhouseConfig prefers this over CLICKHOUSE_DATABASE
process.env.JWT_SECRET = "test-jwt-secret";
process.env.NEXTAUTH_SECRET = "test-nextauth-secret";
// audit-log.ts snapshots this at import time
process.env.CONSOLE_ENABLE_AUDIT_LOG = "true";
// telemetry.ts snapshots at import time; keep both paths off so no test fires
// telemetry HTTP in the background
process.env.JITSU_DISABLE_ANONYMOUS_TELEMETRY = "1";
delete process.env.JITSU_PRODUCT_TELEMETRY_HOST;
delete process.env.EE_CONNECTION; // isEEAvailable() → false, EE quota checks skipped
// Fake hosts for external services — every request to them must have an MSW handler
process.env.SYNCCTL_URL = "http://syncctl.test.local";
process.env.BULKER_URL = "http://bulker.test.local";
process.env.FUNCTIONS_SERVER_URL_TEMPLATE = "http://fs-${workspaceId}.test.local";
process.env.JITSU_PUBLIC_URL = "http://console.test.local";

// Claim ClickHouse: the same DDL the admin/events-log-init route runs in prod
// (database + events_log/task_log/dead_letter + retention machinery), pointed
// at this file's database. Imported dynamically — env above is already final.
{
  const { initEventsLogTables, initMetricsTables } = await import("../../../lib/server/clickhouse-init");
  const chAdmin = createClient({ url: chUrl });
  try {
    // Same DDL (and single source) the admin/events-log-init route runs in
    // prod, pointed at this file's database. No cluster → ON CLUSTER dropped
    // and replicated engines de-replicated by the templates' single-node path.
    const initOpts = { clickhouse: chAdmin, database: chDb, username: "default", password: "" };
    await initEventsLogTables(initOpts);
    await initMetricsTables(initOpts);
  } finally {
    await chAdmin.close();
  }
}

passthroughPrefixes.push(chUrl);
startMsw();
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
