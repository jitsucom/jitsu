import chalk from "chalk";
import path from "path";
import { existsSync, readFileSync } from "fs";

export function loadPackageJson(projectDir: string): any {
  const packageJsonPath = path.resolve(projectDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    console.error(`${chalk.red("Can't find node.js project in:")} ${chalk.bold(projectDir)}`);
    process.exit(1);
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  // if (!packageJson.devDependencies?.["jitsu-cli"]) {
  //   console.error(`${chalk.red("jitsu-cli can work only with projects that was created by jitsu-cli")}`);
  //   process.exit(1);
  // }
  return packageJson;
}

export function getDistFile(projectDir: string, packageJson: any) {
  const distFile = path.resolve(projectDir, packageJson.main || "dist/index.js");
  if (!existsSync(distFile)) {
    console.error(`${chalk.red("Can't find dist file:")} ${chalk.bold(distFile)} . Please build project first.`);
    process.exit(1);
  }
  return distFile;
}
