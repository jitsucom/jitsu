import inquirer from "inquirer";
import path from "path";
import { sanitize } from "juava";
import { write } from "../lib/template";
import { functionProjectTemplate } from "../templates/functions";
import { jitsuCliVersion } from "../lib/version";
import { b } from "../lib/chalk-code-highlight";

export async function init({ name, parent, displayname }: { name?: string; parent?: string; displayname?: string }) {
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

  const functionName =
    displayname ||
    (
      await inquirer.prompt([
        {
          type: "input",
          name: "functionName",
          message: `Enter function name. Human readable function name that will be used in Jitsu:`,
        },
      ])
    ).functionName;

  const projectDir = path.resolve(parentDir, sanitize(projectName));

  console.log(`Creating project ${b(projectName)}. Path: ${projectDir}`);

  write(projectDir, functionProjectTemplate, {
    packageName: projectName,
    functionName: functionName,
    jitsuVersion: jitsuCliVersion,
  });

  console.log(`Project ${b(projectName)} created!`);
}
