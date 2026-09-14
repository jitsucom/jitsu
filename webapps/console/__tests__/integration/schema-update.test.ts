/* eslint-disable no-restricted-properties -- schema CLI test passes the isolated test database explicitly. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

it("provisions the same constraints through the standalone deployment CLI and preserves data on rerun", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jitsu-schema-cli-"));
  const bundle = join(directory, "update-schema.mjs");
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("schema", "deployment_test");
  const admin = new Client({ connectionString: url.toString() });
  try {
    // Match all.Dockerfile: only the ESM bundle and canonical schema are adjacent.
    await build({
      entryPoints: ["scripts/update-schema.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
    });
    copyFileSync("prisma/schema.prisma", join(directory, "schema.prisma"));
    const env = {
      ...process.env,
      DATABASE_URL: url.toString(),
      PRISMA_CLI_PATH: createRequire(import.meta.url).resolve("prisma/build/index.js"),
    };
    const update = () => execFileSync(process.execPath, [bundle, "--skip-generate"], { env, stdio: "pipe" });
    update();
    await admin.connect();
    await admin.query("INSERT INTO deployment_test.source_state (sync_id,stream,state) VALUES ('sync','stream','{}')");
    update();
    const constraint = await admin.query(
      `SELECT convalidated, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid='deployment_test.reverse_sync_control'::regclass AND conname='reverse_sync_billing_period_order'`
    );
    expect(constraint.rows).toEqual([
      { convalidated: true, definition: "CHECK ((billing_period_end > billing_period_start))" },
    ]);
    expect((await admin.query("SELECT sync_id FROM deployment_test.source_state")).rows).toEqual([{ sync_id: "sync" }]);
    // Errors must reach the deployment caller instead of starting an unmigrated app.
    url.searchParams.set("schema", "invalid-schema");
    const failed = spawnSync(process.execPath, [bundle, "--skip-generate"], {
      env: { ...env, DATABASE_URL: url.toString() },
      encoding: "utf8",
    });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain("Invalid database schema");
  } finally {
    await admin.end();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
