import path from "path";
import { homedir } from "os";
import inquirer from "inquirer";
import { existsSync, readdirSync, readFileSync } from "fs";
import { loadPackageJson } from "./shared";
import fetch from "node-fetch";
import { UDFWrapper } from "@jitsu/core-functions";
import cuid from "cuid";
import { b, red } from "../lib/chalk-code-highlight";

export async function deploy({ dir, workspace, name: names }: { dir?: string; workspace?: string; name?: string[] }) {
  const { packageJson, projectDir } = await loadPackageJson(dir || process.cwd());

  const selected = names ? names.flatMap(n => n.split(",")).map(n => n.trim()) : undefined;

  const configFile = `${homedir()}/.jitsu/jitsu-cli.json`;
  if (!existsSync(configFile)) {
    console.error(red("Please login first."));
    process.exit(1);
  }

  const functionsDir = path.resolve(projectDir, "dist/functions");
  if (!existsSync(functionsDir)) {
    console.error(red(`Can't find dist directory: ${b(functionsDir)} . Please build project first.`));
    process.exit(1);
  }

  console.log(
    `Deploying ${b(packageJson.name)} project.${selected ? ` (selected functions: ${selected.join(",")})` : ""}`
  );
  const functionsFiles = readdirSync(functionsDir);
  if (functionsFiles.length === 0) {
    console.error(
      red(
        `Can't find function files in ${b(
          "dist/functions"
        )} directory. Please make sure that you have built the project.`
      )
    );
    process.exit(1);
  }
  const selectedFiles: string[] = [];
  if (selected) {
    const s = selected.map(n => (n.endsWith(".js") ? n : `${n.replace(".ts", "")}.js`));
    for (const file of s) {
      if (functionsFiles.includes(file)) {
        selectedFiles.push(file);
      } else {
        console.error(
          red(
            `Can't find function file ${b(file)} in ${b(
              "dist/functions"
            )} directory. Please make sure that you have built the project.`
          )
        );
        process.exit(1);
      }
    }
  } else {
    selectedFiles.push(...functionsFiles);
  }

  const { host, apikey } = JSON.parse(readFileSync(configFile, "utf-8"));
  const res = await fetch(`${host}/api/workspace`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apikey}`,
    },
  });
  if (!res.ok) {
    console.error(red(`Cannot get workspace list:\n${b(await res.text())}`));
    process.exit(1);
  }
  const workspaces = (await res.json()) as any[];

  let workspaceId = workspace;
  if (!workspace) {
    if (workspaces.length === 0) {
      console.error(`${red("No workspaces found")}`);
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
              name: `${w.name} (${w.id})`,
              value: w.id,
            })),
          },
        ])
      ).workspaceId;
    }
  }

  const workspaceName = workspaces.find(w => w.id === workspaceId)?.name;
  if (!workspaceId || !workspaceName) {
    console.error(red(`Workspace with id ${workspaceId} not found`));
    process.exit(1);
  }
  for (const file of selectedFiles) {
    console.log(b(`Deploying function ${b(file)} to workspace '${workspaceName}'`));
    const code = readFileSync(path.resolve(functionsDir, file), "utf-8");
    const wrapped = UDFWrapper(file, file, code);
    const meta = wrapped.meta;
    if (meta) {
      console.log(`Function ${b(file)} meta: slug=${meta.slug}, name=${meta.name}, description=${meta.description}`);
    } else {
      console.log(`File ${b(file)} doesn't have function meta information. ${red("Skipping")}`);
      continue;
    }
    let existingFunctionId: string | undefined;
    if (meta.slug) {
      const res = await fetch(`${host}/api/${workspaceId}/config/function`, {
        headers: {
          Authorization: `Bearer ${apikey}`,
        },
      });
      if (!res.ok) {
        console.error(red(`Cannot add function to workspace:\n${b(await res.text())}`));
        process.exit(1);
      } else {
        const existing = (await res.json()) as any;
        existingFunctionId = existing.objects.find(f => f.slug === meta.slug)?.id;
      }
    }

    if (!existingFunctionId) {
      const id = cuid();
      const res = await fetch(`${host}/api/${workspaceId}/config/function`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apikey}`,
        },
        body: JSON.stringify({
          id,
          workspaceId,
          type: "function",
          origin: "jitsu-cli",
          slug: meta.slug,
          description: meta.description,
          version: packageJson.version,
          name: meta.name,
          code,
        }),
      });
      if (!res.ok) {
        console.error(red(`Cannot add function to workspace:\n${b(await res.text())}`));
        process.exit(1);
      } else {
        console.log(`Function ${b(meta.name)} was successfully added to workspace ${workspaceName} with id: ${b(id)}`);
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
          slug: meta.slug,
          description: meta.description,
          version: packageJson.version,
          name: meta.name,
          code,
        }),
      });
      if (!res.ok) {
        console.error(red(`Cannot patch function ${name}(${id}):\n${b(await res.text())}`));
        process.exit(1);
      } else {
        console.log(
          `Function ${b(meta.name)} (id: ${b(id)}) was successfully updated in workspace ${b(workspaceName)}`
        );
      }
    }
  }
}
