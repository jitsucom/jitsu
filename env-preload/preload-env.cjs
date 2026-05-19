"use strict";

// Layered .env.local preload. Loaded via --require in the root .npmrc's
// node-options, so every pnpm-spawned node process runs this before its
// main script. See CONTRIBUTING.md "Environment variables".
//
// Layers (later wins; existing process.env always wins over both):
//   1. ~/.jitsu/.env.local       (shared across worktrees)
//   2. <repo-root>/.env.local    (per-worktree)
//
// CommonJS so it works as a --require target without an ESM dance. Plain
// Node — no dependencies. Failures are non-fatal: we never want a bad .env
// to brick `pnpm install` or any script.

const fs = require("node:fs");
const path = require("node:path");

// Snapshot keys the shell already set BEFORE we touch anything. Used by
// loadEnvFile to decide what's untouchable (shell wins) vs what a later
// file is allowed to override (an earlier file's value).
const shellEnvKeys = new Set(Object.keys(process.env));

function findRepoRoot(start) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadEnvFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EACCES") return;
    throw err;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    // Only the shell's original env is untouchable. A key set by an earlier
    // file (e.g. ~/.jitsu/.env.local) gets overwritten here, which is the
    // documented "later wins" precedence.
    if (shellEnvKeys.has(key)) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

try {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) loadEnvFile(path.join(home, ".jitsu", ".env.local"));

  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot) loadEnvFile(path.join(repoRoot, ".env.local"));
} catch (err) {
  // Last-resort safety net so a busted .env can never brick a script.
  process.stderr.write(`[preload-env] failed: ${err.message}\n`);
}
