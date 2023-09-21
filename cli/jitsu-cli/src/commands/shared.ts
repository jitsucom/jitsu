import path from "path";
import { existsSync, readFileSync } from "fs";
import { b, red } from "../lib/chalk-code-highlight";

export function loadPackageJson(projectDir: string): any {
  const packageJsonPath = path.resolve(projectDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    console.error(red(`Can't find node.js project in: ${b(projectDir)}`));
    process.exit(1);
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  // if (!packageJson.devDependencies?.["jitsu-cli"]) {
  //   console.error(`${red("jitsu-cli can work only with projects that was created by jitsu-cli")}`);
  //   process.exit(1);
  // }
  return packageJson;
}
