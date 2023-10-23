import path from "path";
import inquirer from "inquirer";
import { existsSync, readFileSync } from "fs";
import { b, red } from "../lib/chalk-code-highlight";

export async function loadPackageJson(projectDir: string): Promise<{ projectDir: string; packageJson: any }> {
  let packageJson = loadPackageJson0(projectDir);
  if (!packageJson) {
    projectDir = (
      await inquirer.prompt([
        {
          type: "input",
          name: "dir",
          message: `Enter path of project directory:`,
        },
      ])
    ).dir;
    packageJson = loadPackageJson0(projectDir);
    if (!packageJson) {
      process.exit(1);
    }
  }
  return { projectDir, packageJson };
}

export function loadPackageJson0(projectDir: string): any {
  const packageJsonPath = path.resolve(projectDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    console.error(red(`Can't find node.js project in: ${b(projectDir)}`));
    return undefined;
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  if (!packageJson.devDependencies?.["jitsu-cli"]) {
    console.error(red(`directory ${b(projectDir)} doesn't contain jitsu-cli managed project`));
    return undefined;
  }
  return packageJson;
}
