import { ApiClient, ApiError } from "../../lib/api-client";
import { readDefaultWorkspace, resolveAuth } from "../../lib/auth-file";
import { buildBody } from "../../lib/body-builder";
import { consumeBodyFields } from "../../lib/body-fields";
import { print } from "../../lib/renderer";
import { Resource } from "./resources";

// `/api/{workspaceId}/config/...` endpoints take an ID — passing a slug returns empty
// silently. Resolve via `/api/workspace/{idOrSlug}` first so `-w canalrcn` works and
// `-w nonexistent-slug` errors out clearly instead of returning [].
async function resolveWorkspaceId(client: ApiClient, idOrSlug: string): Promise<string> {
  // Always go through the resolution endpoint. The server-side slug validator rejects
  // slugs that collide with any existing workspace id, so an id and a slug can never
  // map to different workspaces here.
  try {
    const ws = await client.request<{ id: string }>({
      method: "GET",
      path: `/api/workspace/${encodeURIComponent(idOrSlug)}`,
    });
    return ws.id;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      throw new Error(`Workspace '${idOrSlug}' not found (or you don't have access)`);
    }
    throw e;
  }
}

// Common shape of leaf-command options (those known to Commander).
export type LeafOpts = {
  workspace?: string;
  output?: string;
  host?: string;
  apikey?: string;
  file?: string;
  json?: string;
  cascade?: boolean;
  strict?: boolean;
  from?: string;
  to?: string;
};

// Combines body sources: -f file, --json inline, and ad-hoc field flags pre-extracted
// from argv (e.g. --credentials.password=secret, --destinationType=postgres).
function gatherBody(opts: LeafOpts) {
  const fields = consumeBodyFields();
  return buildBody({ file: opts.file, json: opts.json, fields });
}

function requireWorkspace(opts: LeafOpts): string {
  if (opts.workspace) return opts.workspace;
  const fallback = readDefaultWorkspace();
  if (fallback) return fallback;
  throw new Error("--workspace / -w is required (or set a default via `jitsu set-default-workspace <id-or-slug>`)");
}

async function requireResolvedWorkspaceId(opts: LeafOpts, client: ApiClient): Promise<string> {
  return resolveWorkspaceId(client, requireWorkspace(opts));
}

// ----------------- list -----------------

export async function runList(resource: Resource, opts: LeafOpts) {
  const auth = resolveAuth(opts);
  const client = new ApiClient(auth);

  switch (resource.kind) {
    case "workspace": {
      const data = await client.request({ method: "GET", path: "/api/workspace" });
      print(data, opts.output);
      return;
    }
    case "configObject": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      const data = await client.request<{ objects: unknown[] }>({
        method: "GET",
        path: `/api/${encodeURIComponent(ws)}/config/${resource.type}`,
      });
      // Server returns { objects: [...] } — print the array directly so YAML/JSON
      // are list-shaped and easier to pipe into other tools.
      print(data.objects ?? data, opts.output);
      return;
    }
    case "link": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      const data = await client.request<{ links: unknown[] }>({
        method: "GET",
        path: `/api/${encodeURIComponent(ws)}/config/link`,
      });
      print(data.links ?? data, opts.output);
      return;
    }
    case "profile-builder": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      const data = await client.request<{ profileBuilders: unknown[] }>({
        method: "GET",
        path: `/api/${encodeURIComponent(ws)}/config/profile-builder`,
      });
      print(data.profileBuilders ?? data, opts.output);
      return;
    }
  }
}

// ----------------- get -----------------

export async function runGet(resource: Resource, id: string, opts: LeafOpts) {
  const auth = resolveAuth(opts);
  const client = new ApiClient(auth);

  switch (resource.kind) {
    case "workspace": {
      // /api/workspace/{idOrSlug} accepts either; no extra resolution needed.
      const data = await client.request({ method: "GET", path: `/api/workspace/${encodeURIComponent(id)}` });
      print(data, opts.output);
      return;
    }
    case "configObject": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      const data = await client.request({
        method: "GET",
        path: `/api/${encodeURIComponent(ws)}/config/${resource.type}/${encodeURIComponent(id)}`,
      });
      print(data, opts.output);
      return;
    }
    default:
      throw new Error(`get is not supported for ${resource.noun}`);
  }
}

// ----------------- create -----------------

export async function runCreate(resource: Resource, opts: LeafOpts) {
  const auth = resolveAuth(opts);
  const client = new ApiClient(auth);
  const body = gatherBody(opts) ?? {};

  switch (resource.kind) {
    case "workspace": {
      const data = await client.request({ method: "POST", path: "/api/workspace", body });
      print(data, opts.output);
      return;
    }
    case "configObject": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      const data = await client.request({
        method: "POST",
        path: `/api/${encodeURIComponent(ws)}/config/${resource.type}`,
        body,
      });
      print(data, opts.output);
      return;
    }
    case "link": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      const data = await client.request({
        method: "POST",
        path: `/api/${encodeURIComponent(ws)}/config/link`,
        body,
      });
      print(data, opts.output);
      return;
    }
    case "profile-builder": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      const data = await client.request({
        method: "POST",
        path: `/api/${encodeURIComponent(ws)}/config/profile-builder`,
        body,
      });
      print(data, opts.output);
      return;
    }
  }
}

// ----------------- update -----------------

export async function runUpdate(resource: Resource, id: string | undefined, opts: LeafOpts) {
  const auth = resolveAuth(opts);
  const client = new ApiClient(auth);
  const body = gatherBody(opts);
  if (body === undefined) {
    throw new Error("update requires at least one of -f, --json, or --field.path=value flags");
  }

  switch (resource.kind) {
    case "workspace": {
      if (!id) throw new Error("workspace id or slug is required");
      const data = await client.request({
        method: "PUT",
        path: `/api/workspace/${encodeURIComponent(id)}`,
        body,
      });
      print(data, opts.output);
      return;
    }
    case "configObject": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      if (!id) throw new Error("id is required");
      const data = await client.request({
        method: "PUT",
        path: `/api/${encodeURIComponent(ws)}/config/${resource.type}/${encodeURIComponent(id)}`,
        body,
      });
      print(data ?? { ok: true }, opts.output);
      return;
    }
    case "link": {
      // Link upsert — server identifies via id (or fromId+toId) in the body.
      // If the user passed a positional id, fold it into body.id so it actually reaches the API.
      const ws = await requireResolvedWorkspaceId(opts, client);
      const finalBody = mergePositionalId(body, id, "id");
      const data = await client.request({
        method: "PUT",
        path: `/api/${encodeURIComponent(ws)}/config/link`,
        body: finalBody,
      });
      print(data, opts.output);
      return;
    }
    case "profile-builder": {
      // Upsert keyed off body.profileBuilder.id; without it the API creates a new builder
      // even though the CLI signature requires <id>. Inject the positional id.
      const ws = await requireResolvedWorkspaceId(opts, client);
      if (!id) throw new Error("id is required");
      const finalBody = mergeNestedPositionalId(body, id, "profileBuilder", "id");
      const data = await client.request({
        method: "PUT",
        path: `/api/${encodeURIComponent(ws)}/config/profile-builder`,
        body: finalBody,
      });
      print(data, opts.output);
      return;
    }
  }
}

// Set `body[key] = id` when id is given. Throws if body[key] is already set to a different value.
function mergePositionalId(body: any, id: string | undefined, key: string): any {
  if (id === undefined) return body;
  if (body && typeof body === "object" && body[key] !== undefined && body[key] !== id) {
    throw new Error(`positional id '${id}' conflicts with body.${key} '${body[key]}'`);
  }
  return { ...(body && typeof body === "object" ? body : {}), [key]: id };
}

// Same idea, one level deep: set `body[outer][inner] = id`.
function mergeNestedPositionalId(body: any, id: string, outer: string, inner: string): any {
  const base = body && typeof body === "object" ? body : {};
  const nested = base[outer] && typeof base[outer] === "object" ? base[outer] : {};
  if (nested[inner] !== undefined && nested[inner] !== id) {
    throw new Error(`positional id '${id}' conflicts with body.${outer}.${inner} '${nested[inner]}'`);
  }
  return { ...base, [outer]: { ...nested, [inner]: id } };
}

// ----------------- delete -----------------

export async function runDelete(resource: Resource, id: string | undefined, opts: LeafOpts) {
  const auth = resolveAuth(opts);
  const client = new ApiClient(auth);

  switch (resource.kind) {
    case "workspace": {
      if (!id) throw new Error("workspace id is required");
      const data = await client.request({
        method: "DELETE",
        path: "/api/workspace",
        body: { workspaceId: id },
      });
      print(data, opts.output);
      return;
    }
    case "configObject": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      if (!id) throw new Error("id is required");
      const query: Record<string, string> = {};
      if (opts.cascade) query.cascade = "true";
      if (opts.strict) query.strict = "true";
      const data = await client.request({
        method: "DELETE",
        path: `/api/${encodeURIComponent(ws)}/config/${resource.type}/${encodeURIComponent(id)}`,
        query,
      });
      print(data ?? { ok: true }, opts.output);
      return;
    }
    case "link": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      const query: Record<string, string> = {};
      if (id) {
        query.id = id;
      } else if (opts.from && opts.to) {
        query.fromId = opts.from;
        query.toId = opts.to;
      } else {
        throw new Error("connection delete requires either <id> or both --from and --to");
      }
      const data = await client.request({
        method: "DELETE",
        path: `/api/${encodeURIComponent(ws)}/config/link`,
        query,
      });
      print(data ?? { ok: true }, opts.output);
      return;
    }
    case "profile-builder": {
      const ws = await requireResolvedWorkspaceId(opts, client);
      if (!id) throw new Error("id is required");
      const data = await client.request({
        method: "DELETE",
        path: `/api/${encodeURIComponent(ws)}/config/profile-builder`,
        query: { id },
      });
      print(data ?? { ok: true }, opts.output);
      return;
    }
  }
}

// ----------------- test (configObject only) -----------------

export async function runTest(resource: Resource, opts: LeafOpts) {
  if (resource.kind !== "configObject" || !resource.supportsTest) {
    throw new Error(`test is not supported for ${resource.noun}`);
  }
  const auth = resolveAuth(opts);
  const client = new ApiClient(auth);
  const ws = await requireResolvedWorkspaceId(opts, client);
  const body = gatherBody(opts) ?? {};
  const data = await client.request({
    method: "POST",
    path: `/api/${encodeURIComponent(ws)}/config/${resource.type}/test`,
    body,
  });
  print(data, opts.output);
}
