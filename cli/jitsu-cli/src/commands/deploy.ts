import path from "path";
import { homedir } from "os";
import inquirer from "inquirer";
import { existsSync, readdirSync, readFileSync } from "fs";
import { loadPackageJson } from "./shared";
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

  if (!existsSync(functionsDir)) {
    console.warn(`No ${b(dir)} directory found, skipping ${kind}s. Please make sure that you have built the project.`);
    return;
  }
  const functionsFiles = readdirSync(functionsDir);
  if (functionsFiles.length === 0) {
    console.warn(`No ${kind} files found in ${b(dir)}, skipping. Please make sure that you have built the project.`);
    return;
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

  // Fetch the existing function list once for slug/id resolution. Previously
  // every deployFunction() call refetched the whole list (with code blobs) —
  // O(N) requests per deploy, each pulling all N rows from the console DB.
  const existingFunctions = await fetchExistingFunctions({ host, apikey, workspaceId: workspace.id! });

  for (const file of selectedFiles) {
    console.log(
      `${b(`𝑓`)} Deploying function ${b(path.basename(file))} to workspace ${workspace.name} (${host}/${
        workspace.slug || workspace.id
      })`
    );
    await deployFunction(
      projectDir,
      { host, apikey },
      packageJson,
      workspace,
      kind,
      path.resolve(functionsDir, file),
      profileBuilders,
      existingFunctions
    );
  }
}

// Cache of functions already present in the workspace. byId and bySlug share
// object identity so a single mutation visible from both. `slug` is tracked
// per entry so we can detect (and reflect) renames on PUT.
type ExistingFunction = { id: string; slug?: string };
type ExistingFunctionsCache = {
  bySlug: Map<string, ExistingFunction>;
  byId: Map<string, ExistingFunction>;
};

async function fetchExistingFunctions({
  host,
  apikey,
  workspaceId,
}: {
  host?: string;
  apikey?: string;
  workspaceId?: string;
}): Promise<ExistingFunctionsCache> {
  const res = await fetch(`${host}/api/${workspaceId}/config/function`, {
    headers: { Authorization: `Bearer ${apikey}` },
  });
  if (!res.ok) {
    console.error(red(`Cannot list existing functions:\n${b(await res.text())}`));
    process.exit(1);
  }
  const { objects } = (await res.json()) as { objects: { id: string; slug?: string }[] };
  const bySlug = new Map<string, ExistingFunction>();
  const byId = new Map<string, ExistingFunction>();
  for (const f of objects) {
    const entry: ExistingFunction = { id: f.id, slug: f.slug };
    byId.set(f.id, entry);
    if (f.slug) bySlug.set(f.slug, entry);
  }
  return { bySlug, byId };
}

// Update the cache after a successful POST. Both maps must reflect the new
// function so a later file with the same slug/id in this same deploy run
// switches to PUT instead of trying a second POST.
function cacheAfterCreate(cache: ExistingFunctionsCache, id: string, slug: string | undefined) {
  const entry: ExistingFunction = { id, slug };
  cache.byId.set(id, entry);
  if (slug) cache.bySlug.set(slug, entry);
}

// Update the cache after a successful PUT. Preserves the previous re-fetch
// semantics for slug renames: the old slug is no longer pointing at this id
// on the server, so drop it from the slug index and install the new one.
function cacheAfterUpdate(cache: ExistingFunctionsCache, id: string, newSlug: string | undefined) {
  const entry = cache.byId.get(id);
  if (!entry) {
    // Function existed only on the server, not in our hoisted cache (shouldn't
    // normally happen since the PUT branch only runs when we resolved an id).
    // Insert defensively so later files in this run see it.
    cacheAfterCreate(cache, id, newSlug);
    return;
  }
  if (entry.slug && entry.slug !== newSlug) {
    cache.bySlug.delete(entry.slug);
  }
  entry.slug = newSlug;
  if (newSlug) cache.bySlug.set(newSlug, entry);
}

async function deployFunction(
  projectDir: string,
  { host, apikey }: Args,
  packageJson: any,
  workspace: Workspace,
  kind: "function" | "profile",
  file: string,
  profileBuilders: any[] = [],
  existingFunctions: ExistingFunctionsCache = {
    bySlug: new Map(),
    byId: new Map(),
  }
) {
  const code = readFileSync(file, "utf-8");

  const wrapped = await getFunctionFromFilePath(projectDir, file, kind, profileBuilders);
  const meta = wrapped.meta;
  if (meta) {
    console.log(`  meta: slug=${meta.slug}, name=${meta.name || "not set"}`);
  } else {
    console.log(`File ${b(path.basename(file))} doesn't have function meta information. ${red("Skipping")}`);
    return;
  }
  let existingFunctionId: string | undefined;
  if (meta.slug) {
    existingFunctionId =
      existingFunctions.bySlug.get(meta.slug)?.id ?? (meta.id ? existingFunctions.byId.get(meta.id)?.id : undefined);
  }
  let functionPayload = {};
  if (kind === "profile") {
    functionPayload = {
      draft: code,
      kind: "profile",
    };
  } else {
    functionPayload = {
      code,
    };
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
        // we always add code to the initial function creation
        code,
        ...functionPayload,
      }),
    });
    if (!res.ok) {
      console.error(red(`Cannot add function to workspace:\n${b(await res.text())}`));
      process.exit(1);
    } else {
      // Reflect the new function in the hoisted cache so a later file in
      // this same deploy that targets the same slug switches to PUT instead
      // of POSTing a duplicate. Matches the pre-hoist behavior where each
      // file re-fetched the list.
      cacheAfterCreate(existingFunctions, id, meta.slug);
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
        ...functionPayload,
      }),
    });
    if (!res.ok) {
      console.error(red(`⚠ Cannot deploy function ${b(meta.slug)}(${id}):\n${b(await res.text())}`));
      process.exit(1);
    } else {
      // Slug may have been renamed by this PUT — update the slug index so a
      // later file deploying under the old slug (if any) creates a new
      // function instead of clobbering this one.
      cacheAfterUpdate(existingFunctions, id, meta.slug);
      console.log(`${green(`✓`)} ${b(meta.name)} deployed successfully!`);
    }
  }
}
