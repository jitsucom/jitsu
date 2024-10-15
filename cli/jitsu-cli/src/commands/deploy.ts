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

type Args = {
  dir?: string;
  workspace?: string;
  name?: string[];
  apikey?: string;
  host?: string;
};

type Workspace = {
  id?: string;
  name?: string[];
  slug?: string;
};

export async function deploy({ dir, workspace, name: names, ...params }: Args) {
  const { packageJson, projectDir } = await loadPackageJson(dir || process.cwd());

  const { host, apikey } = params.apikey
    ? { apikey: params.apikey, host: params.host || "https://use.jitsu.com" }
    : readLoginFile();

  console.log(
    `Deploying ${b(packageJson.name)} project.${
      names && names.length > 0 ? ` (selected functions: ${names.join(",")})` : ""
    }`
  );

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
  if (!workspaceId || !workspaceName) {
    console.error(red(`Workspace with id ${workspaceId} not found`));
    process.exit(1);
  }
  await deployFunctions({ ...params, host, apikey, name: names }, projectDir, packageJson, workspaceObj, "function");
  await deployFunctions({ ...params, host, apikey, name: names }, projectDir, packageJson, workspaceObj, "profile");
}

async function deployFunctions(
  { host, apikey, name: names }: Args,
  projectDir: string,
  packageJson: any,
  workspace: Workspace,
  kind: "function" | "profile"
) {
  const selected = names ? names.flatMap(n => n.split(",")).map(n => n.trim()) : undefined;
  const dir = `dist/${kind}s`;
  const functionsDir = path.resolve(projectDir, dir);

  const functionsFiles = readdirSync(functionsDir);
  if (functionsFiles.length === 0) {
    console.warn(
      red(`Can't find function files in ${b(dir)} directory. Please make sure that you have built the project.`)
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
              dir
            )} directory. Please make sure that you have built the project.`
          )
        );
        process.exit(1);
      }
    }
  } else {
    selectedFiles.push(...functionsFiles);
  }

  let profileBuilders: any[] = [];
  if (kind == "profile") {
    const res = await fetch(`${host}/api/${workspace.id}/config/profile-builder`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apikey}`,
      },
    });
    if (!res.ok) {
      console.error(red(`Cannot get profile builders list:\n${b(await res.text())}`));
      process.exit(1);
    }
    profileBuilders = ((await res.json()) as any).profileBuilders as any[];
  }

  for (const file of selectedFiles) {
    console.log(
      `${b(`𝑓`)} Deploying function ${b(path.basename(file))} to workspace ${workspace.name} (${host}/${
        workspace.slug || workspace.id
      })`
    );
    await deployFunction(
      { host, apikey },
      packageJson,
      workspace,
      kind,
      path.resolve(functionsDir, file),
      profileBuilders
    );
  }
}

async function deployFunction(
  { host, apikey }: Args,
  packageJson: any,
  workspace: Workspace,
  kind: "function" | "profile",
  file: string,
  profileBuilders: any[] = []
) {
  const code = readFileSync(file, "utf-8");

  const wrapped = await getFunctionFromFilePath(file, kind, profileBuilders);
  const meta = wrapped.meta;
  if (meta) {
    console.log(`  meta: slug=${meta.slug}, name=${meta.name || "not set"}`);
  } else {
    console.log(`File ${b(path.basename(file))} doesn't have function meta information. ${red("Skipping")}`);
    return;
  }
  let existingFunctionId: string | undefined;
  if (meta.slug) {
    const res = await fetch(`${host}/api/${workspace.id}/config/function`, {
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
    const res = await fetch(`${host}/api/${workspace.id}/config/function`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apikey}`,
      },
      body: JSON.stringify({
        id,
        workspaceId: workspace.id,
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
      console.log(`Function ${b(meta.name)} was successfully added to workspace ${workspace.name} with id: ${b(id)}`);
    }
  } else {
    const id = existingFunctionId;
    const res = await fetch(`${host}/api/${workspace.id}/config/function/${id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apikey}`,
      },
      body: JSON.stringify({
        id: id,
        workspaceId: workspace.id,
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
