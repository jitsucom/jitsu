#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const argv = process.argv.slice(2).filter((a, i, arr) => !(i === 0 && a === "--"));
const [subcommand, ...rest] = argv;

async function main() {
  switch (subcommand) {
    case undefined:
    case "start":
    case "up": {
      // Env loading is handled by NODE_OPTIONS in the root .npmrc; just run turbo.
      const child = spawn("pnpm", ["exec", "turbo", "run", "dev"], { stdio: "inherit", cwd: repoRoot });
      child.on("exit", code => process.exit(code ?? 0));
      return;
    }
    case "copy-db": {
      const { runCopyDb } = await import("./commands/copy-db.ts");
      await runCopyDb(rest);
      return;
    }
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(2);
  }
}

function printHelp() {
  console.error(
    [
      "Usage: pnpm dev <subcommand> [...args]",
      "",
      "Subcommands:",
      "  (none)               turbo run dev (start all dev services)",
      "  copy-db --src URL --dst URL [--clean-dst] [--all-tables]",
      "                                copy a postgres database (schema + data)",
      "                                URLs may use $ENV_VAR placeholders",
      "                                extensions are not copied; --clean-dst skips prompt",
      "                                a few large log/audit tables are structure-only",
      "                                by default; --all-tables copies their rows too",
      "  help                 show this help",
    ].join("\n")
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
