import inquirer from "inquirer";
import path from "path";
import { b } from "../lib/chalk-code-highlight";
import * as fs from "fs";
import { functionProjectTemplate } from "../templates/functions";
import { write } from "../lib/template";
import { jitsuCliVersion } from "../lib/version";

export async function init(dir?: string, opts?: { jitsuVersion?: string; allowNonEmptyDir?: boolean }) {
  let projectName;
  if (dir) {
    dir = path.resolve(dir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    } else if (fs.readdirSync(dir).length > 0) {
      const msg = `Directory ${b(dir)} is not empty, can't create project there`;
      if (opts?.allowNonEmptyDir) {
        console.warn(`Directory ${b(dir)} is not empty. Will create project there, files may be overwritten`);
      } else {
        console.error(msg);
        process.exit(1);
      }
    }
    projectName = path.basename(dir);
  } else {
    projectName = (
      await inquirer.prompt([
        {
          type: "input",
          name: "project",
          message: `Enter project name. It will be used as a package name and directory name:`,
        },
      ])
    ).project;
    dir = path.resolve(projectName);
  }

  write(dir, functionProjectTemplate, {
    packageName: projectName,
    jitsuVersion: opts?.jitsuVersion || jitsuCliVersion,
  });

  console.log(`Project ${b(projectName)} created!`);
}
