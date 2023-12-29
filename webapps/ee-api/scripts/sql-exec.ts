/**
 * This script is used during build time only. It compliments `prisma schema push` and should be run after it.
 *
 * It makes sure that certain objects, such as views and triggers, that cannot be defined in Prisma schema are created in the database.
 * It does so by executing SQL scripts that are located in a directory provided as a first argument.
 *
 * It also relies on presence of APPLICATION_DATABASE_URL environment variable (same as `prisma schema push`).
 *
 * NOTE: This as mostly a copy of webapps/console/scripts/sql-exec.ts, since ee-api and console doesn't have a common dependency where we
 * can put this script. A little copy-paste is not a big deal!
 */
import { Client } from "pg";
import * as fs from "fs";
import path from "path";

async function main() {
  const _sqlDir = process.argv[2];
  if (!_sqlDir) {
    throw new Error("SQL directory is not provided. It should be the first argument");
  }
  const sqlDir = path.resolve(_sqlDir);
  console.log(`Running SQL scripts from ${sqlDir}`);

  const dbUrl = process.env.APPLICATION_DATABASE_URL;
  if (!dbUrl) {
    throw new Error("APPLICATION_DATABASE_URL is not defined");
  }
  const defaultSchema = new URL(dbUrl).searchParams.get("schema");
  const client = new Client({
    connectionString: dbUrl,
  });
  await client.connect();
  console.log(`✅ Connected to SQL database`);
  if (defaultSchema) {
    await client.query(`SET search_path TO "${defaultSchema}"`);
  }
  const files = fs.readdirSync(sqlDir);
  for (const file of files) {
    const fullPath = path.join(sqlDir, file);
    const sql = fs.readFileSync(fullPath, "utf-8");
    process.stdout.write(`Running ${file}...`);
    try {
      const replacedSql = sql.replace(/\$\{(\w+)}/g, (_, envVarName) => {
        const envVarValue = process.env[envVarName];
        if (!envVarValue) {
          throw new Error(`Environment variable ${envVarName} is not defined`);
        }
        return envVarValue;
      });
      await client.query(replacedSql);
      process.stdout.write(`\r✅ ${file} - DONE\n`);
    } catch (e: any) {
      process.stdout.write(`\r🔴 ${file} - ERROR\n`);
      console.error(`Error executing SQL script from ${fullPath}: ${e?.message || "unknown error"}`, e);
      process.exit(1);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(`🔴Error executing SQL scripts: ${e?.message || "unknown error"}`, e);
    process.exit(1);
  });
