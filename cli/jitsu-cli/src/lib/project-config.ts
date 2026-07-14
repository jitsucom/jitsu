import path from "path";
import { existsSync, readFileSync } from "fs";
import { b } from "./chalk-code-highlight";

// Per-project Jitsu configuration, committed alongside the project so a deploy
// doesn't need machine-global state or CLI flags. Vercel-style (jitsu.json).
export type ProjectConfig = {
  // Workspace id or slug to deploy to. Overridden by the -w/--workspace flag.
  workspace?: string;
};

// Reads per-project config. Precedence:
//   1. jitsu.json at the project root
//   2. "jitsu" key in package.json
// Returns {} when neither is present. `packageJson` is passed in to avoid a
// second read of a file the caller already parsed.
export function loadProjectConfig(projectDir: string, packageJson?: any): ProjectConfig {
  const jitsuJsonPath = path.resolve(projectDir, "jitsu.json");
  if (existsSync(jitsuJsonPath)) {
    let parsed: any;
    try {
      parsed = JSON.parse(readFileSync(jitsuJsonPath, "utf-8"));
    } catch (e) {
      throw new Error(`Failed to parse ${b(jitsuJsonPath)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return parsed ?? {};
  }
  if (packageJson?.jitsu && typeof packageJson.jitsu === "object") {
    return packageJson.jitsu as ProjectConfig;
  }
  return {};
}
