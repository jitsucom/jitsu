import inquirer from "inquirer";
import chalk from "chalk";
import path from "path";
import { sanitize } from "juava";
import { write } from "../lib/template";
import { functionProjectTemplate } from "../templates/functions";
import { jitsuCliVersion } from "../lib/version";

export async function init({ name, parent }: { name?: string; parent?: string }) {
  const currentDir = process.cwd();

  const projectName =
    name ||
    (
      await inquirer.prompt([
        {
          type: "input",
          name: "project",
          message: `Enter project name. It will be used as a package name and directory name:`,
        },
      ])
    ).project;

  const parentDir =
    parent ||
    (
      await inquirer.prompt([
        {
          type: "input",
          name: "dir",
          default: currentDir,
          message: `Enter parent directory of project:`,
        },
      ])
    ).dir;

  const projectDir = path.resolve(parentDir, sanitize(projectName));

  console.log(`Creating project ${chalk.bold(projectName)}. Path: ${projectDir}`);

  write(projectDir, functionProjectTemplate, {
    packageName: projectName,
    jitsuVersion: jitsuCliVersion,
  });
}
