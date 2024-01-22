import path from "path";
import { homedir } from "os";
import inquirer from "inquirer";
import { existsSync, readdirSync, readFileSync } from "fs";
import { loadPackageJson } from "./shared";
import fetch from "node-fetch";
import cuid from "cuid";
import { b, green, red } from "../lib/chalk-code-highlight";
import { getFunctionFromFilePath } from "../lib/compiled-function";

function readLoginFile() {
  const configFile = `${homedir()}/.jitsu/jitsu-cli.json`;
  if (!existsSync(configFile)) {
    console.error(red("Please login first with `jitsu-cli login` command or provide --apikey option"));
    process.exit(1);
  }
  return JSON.parse(readFileSync(configFile, { encoding: "utf-8" }));
}

export async function deploy({
  dir,
  workspace,
  name: names,
  ...params
}: {
  dir?: string;
  workspace?: string;
  name?: string[];
  apikey?: string;
  host?: string;
}) {
  const { packageJson, projectDir } = await loadPackageJson(dir || process.cwd());

  const selected = names ? names.flatMap(n => n.split(",")).map(n => n.trim()) : undefined;

  const configFile = `${homedir()}/.jitsu/jitsu-cli.json`;
  const { host, apikey } = params.apikey
    ? { apikey: params.apikey, host: params.host || "https://use.jitsu.com" }
    : readLoginFile();

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

  const workspaceObj = workspaces.find(w => w.id === workspaceId);
  const workspaceName = workspaceObj?.name;
  const workspaceSlug = workspaceObj?.slug || workspaceObj?.id;
  if (!workspaceId || !workspaceName) {
    console.error(red(`Workspace with id ${workspaceId} not found`));
    process.exit(1);
  }
  for (const file of selectedFiles) {
    console.log(`${b(`𝑓`)} Deploying function ${b(file)} to workspace ${workspaceName} (${host}/${workspaceSlug})`);
    const code = readFileSync(path.resolve(functionsDir, file), "utf-8");
    const wrapped = await getFunctionFromFilePath(path.resolve(functionsDir, file));
    const meta = wrapped.meta;
    if (meta) {
      console.log(`  meta: slug=${meta.slug}, name=${meta.name || "not set"}`);
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
        console.error(red(`⚠ Cannot deploy function ${b(meta.slug)}(${id}):\n${b(await res.text())}`));
        process.exit(1);
      } else {
        console.log(`${green(`✓`)} ${b(meta.name)} deployed successfully!`);
      }
    }
  }
}
