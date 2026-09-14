/* eslint-disable no-restricted-properties -- deployment/test helper; DATABASE_URL is passed explicitly. */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Prisma 6 cannot represent this cross-column CHECK. All tables, types and indexes
// remain in schema.prisma; the normal update command applies this one constraint.
export function supplementaryConstraints(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid database schema");
  return `BEGIN;
    SET LOCAL lock_timeout = '5s';
    LOCK TABLE "${schema}".reverse_sync_control IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"${schema}".reverse_sync_control'::regclass AND conname='reverse_sync_billing_period_order') THEN
        ALTER TABLE "${schema}".reverse_sync_control ADD CONSTRAINT reverse_sync_billing_period_order CHECK (billing_period_end > billing_period_start);
      END IF;
    END $$;
    COMMIT;`;
}

export function pushConfigSchema(databaseUrl: string, options: { args?: string[]; prismaCli?: string } = {}) {
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? "public";
  const constraints = supplementaryConstraints(schema); // validate before running DDL
  const prismaCli = options.prismaCli ?? createRequire(import.meta.url).resolve("prisma/build/index.js");
  const schemaPath = fileURLToPath(new URL("./schema.prisma", import.meta.url));
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  execFileSync(process.execPath, [prismaCli, "db", "push", `--schema=${schemaPath}`, ...(options.args ?? [])], {
    env,
    stdio: "inherit",
  });
  execFileSync(process.execPath, [prismaCli, "db", "execute", `--schema=${schemaPath}`, "--stdin"], {
    env,
    input: constraints,
    stdio: ["pipe", "inherit", "inherit"],
  });
}
