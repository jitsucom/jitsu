import chalk from "chalk";
import path from "path";
import { homedir } from "os";
import inquirer from "inquirer";
import cuid from "cuid";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { getDistFile, loadPackageJson } from "./shared";
import fetch from "node-fetch";

export async function deploy({ dir, workspace }: { dir?: string; workspace?: string }) {
  const projectDir = dir || process.cwd();
  console.log(`Deploying ${chalk.bold(projectDir)}`);

  const packageJson = loadPackageJson(projectDir);

  const configFile = `${homedir()}/.jitsu/jitsu-cli.json`;
  if (!existsSync(configFile)) {
    console.error(`${chalk.red("Please login first.")}`);
    process.exit(1);
  }

  const { host, apikey } = JSON.parse(readFileSync(configFile, "utf-8"));
  const res = await fetch(`${host}/api/workspace`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apikey}`,
    },
  });
  if (!res.ok) {
    console.error(`${chalk.red("Cannot get workspace list:")}\n${chalk.bold(await res.text())}`);
    process.exit(1);
  }
  const workspaces = (await res.json()) as any[];

  let workspaceId = workspace;
  if (!workspace) {
    if (workspaces.length === 0) {
      console.error(`${chalk.red("No workspaces found")}`);
      process.exit(1);
    } else if (workspaces.length === 1) {
      workspaceId = workspaces[0].id;
    } else {
      workspaceId = (
        await inquirer.prompt([
          {
            type: "list",
            name: "workspaceId",
            message: `Select workspace:`,
            choices: workspaces.map(w => ({
              name: w.name,
              value: w.id,
            })),
          },
        ])
      ).workspaceId;
    }
  }

  const workspaceName = workspaces.find(w => w.id === workspaceId)?.name;
  if (!workspaceId || !workspaceName) {
    console.error(`${chalk.red(`Workspace with id ${workspaceId} not found`)}`);
    process.exit(1);
  }

  console.log(chalk.bold(`Deploying function to workspace '${workspaceName}'`));

  let existingFunctionId: string | undefined;
  const jitsuJsonPath = path.resolve(projectDir, "jitsu.json");
  let jitsuJson: any = {};
  if (existsSync(jitsuJsonPath)) {
    jitsuJson = JSON.parse(readFileSync(path.resolve(projectDir, "jitsu.json"), "utf-8"));
    existingFunctionId = jitsuJson[workspaceId];
  }

  const distFile = getDistFile(projectDir, packageJson);
  const name = packageJson.name || "function";
  const code = readFileSync(distFile, "utf-8");

  if (!existingFunctionId) {
    const id = cuid();
    const res = await fetch(`${host}/api/${workspaceId}/config/function`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apikey}`,
      },
      body: JSON.stringify({
        id: id,
        workspaceId,
        type: "function",
        origin: "jitsu-cli",
        name,
        code,
      }),
    });
    if (!res.ok) {
      console.error(`${chalk.red("Cannot add function to workspace:")}\n${chalk.bold(await res.text())}`);
      process.exit(1);
    } else {
      writeFileSync(jitsuJsonPath, JSON.stringify({ ...jitsuJson, [workspaceId]: id }, null, 2));
      console.log(`Function ${chalk.bold(name)} with id: ${id} successfully added to workspace ${workspaceName}`);
    }
  } else {
    const id = existingFunctionId;
    const res = await fetch(`${host}/api/${workspaceId}/config/function/${id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apikey}`,
      },
      body: JSON.stringify({
        id: id,
        workspaceId,
        type: "function",
        origin: "jitsu-cli",
        name,
        code,
      }),
    });
    if (!res.ok) {
      console.error(`${chalk.red(`Cannot patch function ${name}(${id}):`)}\n${chalk.bold(await res.text())}`);
      process.exit(1);
    } else {
      writeFileSync(jitsuJsonPath, JSON.stringify({ ...jitsuJson, [workspaceId]: id }, null, 2));
      console.log(`Function ${chalk.bold(name)} with id: ${id} successfully updated in workspace ${workspaceName}`);
    }
  }
}
