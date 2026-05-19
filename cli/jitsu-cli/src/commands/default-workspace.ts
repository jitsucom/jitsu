import { ApiClient, ApiError } from "../lib/api-client";
import { authFilePath, readAuthFile, resolveAuth, updateAuthFile } from "../lib/auth-file";
import { red } from "../lib/chalk-code-highlight";

export type DefaultWorkspaceOpts = {
  host?: string;
  apikey?: string;
};

export async function setDefaultWorkspace(idOrSlug: string, opts: DefaultWorkspaceOpts) {
  try {
    const auth = resolveAuth(opts);
    const client = new ApiClient(auth);
    let workspace: { id: string; slug?: string; name?: string };
    try {
      workspace = await client.request({
        method: "GET",
        path: `/api/workspace/${encodeURIComponent(idOrSlug)}`,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        throw new Error(`Workspace '${idOrSlug}' not found (or you don't have access)`);
      }
      throw e;
    }
    updateAuthFile({ defaultWorkspace: workspace.id });
    const label = workspace.slug ? `${workspace.slug} (${workspace.id})` : workspace.id;
    console.log(`Default workspace set to ${label}.`);
    console.log(`Saved to ${authFilePath()}.`);
  } catch (e) {
    console.error(red(`Error: ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
}

export async function unsetDefaultWorkspace() {
  const file = readAuthFile();
  if (!file?.defaultWorkspace) {
    console.log("No default workspace is set.");
    return;
  }
  updateAuthFile({ defaultWorkspace: undefined });
  console.log("Default workspace unset.");
}
