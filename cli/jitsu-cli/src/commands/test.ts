import chalk from "chalk";
import path from "path";
import { existsSync } from "fs";
import { run as jest } from "jest-cli";
import { loadPackageJson } from "./shared";

export async function test({ dir }: { dir?: string }) {
  const projectDir = dir || process.cwd();
  console.log(`Running tests in ${chalk.bold(projectDir)}`);

  const packageJson = loadPackageJson(projectDir);

  const jestArgs = ["--passWithNoTests", "--projects", projectDir, "--preset", "ts-jest"];

  await jest(jestArgs);
}
