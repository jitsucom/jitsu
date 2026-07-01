import type { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SessionUser } from "../../schema";
import { getResourceJsonSchema } from "../../schema/json-schema";
import { ApiError } from "../../shared/errors";
import { getServerLog } from "../log";
import { type ConfigObjectsService, WORKSPACES_PAGE_MAX } from "../config-objects-service";
import { type EventsLogService, QUERYABLE_TYPES } from "../events-log-service";

const log = getServerLog("mcp-tools");

export interface ToolDeps {
  service: ConfigObjectsService;
  eventsLog: EventsLogService;
}

// Connections (links) are surfaced through the same generic tools as config objects,
// under the pseudo-type "connection", and dispatched to the link methods.
const CONNECTION = "connection";

/** Build a SessionUser from the MCP auth context (see auth.ts `extra`). */
function principalFromAuth(authInfo: AuthInfo | undefined): SessionUser {
  const extra = (authInfo?.extra ?? {}) as Record<string, any>;
  const userId = extra.userId;
  if (!userId) {
    throw new ApiError("No authenticated user on this MCP session", {}, { status: 401 });
  }
  return {
    internalId: userId,
    externalId: extra.externalId ?? userId,
    email: extra.email ?? "",
    name: extra.name ?? extra.email ?? userId,
    loginProvider: extra.loginProvider ?? "mcp",
    authType: "mcp",
    tokenId: extra.refreshTokenId ?? null,
  };
}

/** Run a tool body, turning success into JSON text and errors into an MCP error result. */
async function run(label: string, fn: () => Promise<any>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }] };
  } catch (e: any) {
    const status = e instanceof ApiError ? e.status : undefined;
    log.atWarn().withCause(e).log(`Tool ${label} failed`);
    const message = e?.message ?? "Unknown error";
    return {
      content: [{ type: "text", text: `Error${status ? ` (${status})` : ""}: ${message}` }],
      isError: true,
    };
  }
}

export function registerTools(sdkServer: SdkMcpServer, deps: ToolDeps) {
  const { service, eventsLog } = deps;
  const types = [...service.resourceTypes().filter(t => t !== "misc"), CONNECTION];
  const typeList = types.join(", ");
  const eventTypeList = QUERYABLE_TYPES.join(", ");

  sdkServer.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description:
        "List the Jitsu workspaces the authenticated user can access (paginated, max 100 per page). " +
        "Returns { workspaces, total, limit, offset, hasMore }; page with `offset` while `hasMore` is true. " +
        "Use a workspace `id` as the `workspaceId` argument to other tools.",
      inputSchema: {
        limit: z.number().optional().describe(`Page size (1–${WORKSPACES_PAGE_MAX}, default ${WORKSPACES_PAGE_MAX})`),
        offset: z.number().optional().describe("Number of workspaces to skip (default 0)"),
      },
    },
    async ({ limit, offset }, ctx) =>
      run("list_workspaces", () => service.listWorkspaces(principalFromAuth(ctx.authInfo), { limit, offset }))
  );

  sdkServer.registerTool(
    "list_resources",
    {
      title: "List resources",
      description: `List configuration resources of a given type in a workspace. type ∈ {${typeList}}. Use "${CONNECTION}" for connections (links between streams/services and destinations).`,
      inputSchema: {
        workspaceId: z.string().describe("Workspace id (from list_workspaces)"),
        type: z.string().describe(`Resource type: one of ${typeList}`),
      },
    },
    async ({ workspaceId, type }, ctx) =>
      run("list_resources", () => {
        const user = principalFromAuth(ctx.authInfo);
        return type === CONNECTION ? service.listLinks(user, workspaceId) : service.list(user, workspaceId, type);
      })
  );

  sdkServer.registerTool(
    "get_resource",
    {
      title: "Get resource",
      description: `Get a single configuration resource by id. type ∈ {${typeList}}.`,
      inputSchema: {
        workspaceId: z.string(),
        type: z.string().describe(`Resource type: one of ${typeList}`),
        id: z.string().describe("Resource id"),
      },
    },
    async ({ workspaceId, type, id }, ctx) =>
      run("get_resource", async () => {
        const user = principalFromAuth(ctx.authInfo);
        if (type === CONNECTION) {
          const links = await service.listLinks(user, workspaceId);
          const found = links.find((l: any) => l.id === id);
          if (!found) {
            throw new ApiError(`connection with id ${id} does not exist`, {}, { status: 404 });
          }
          return found;
        }
        return service.get(user, workspaceId, type, id);
      })
  );

  sdkServer.registerTool(
    "get_resource_schema",
    {
      title: "Get resource schema",
      description:
        `JSON Schema describing the payload for creating/updating a resource. type ∈ {${typeList}}. ` +
        `Use \`subtype\` to narrow: a destination/service kind (e.g. "postgres"), or for "${CONNECTION}" the connection kind ("sync", or a destination type for push connections).`,
      inputSchema: {
        type: z.string().describe(`Resource type: one of ${typeList}`),
        subtype: z.string().optional().describe('e.g. "postgres" for a destination, or "sync" for a connection'),
      },
    },
    async ({ type, subtype }) =>
      run("get_resource_schema", async () => getResourceJsonSchema(type === CONNECTION ? "link" : type, subtype))
  );

  sdkServer.registerTool(
    "create_resource",
    {
      title: "Create resource",
      description:
        `Create a configuration resource. type ∈ {${typeList}}. \`data\` must match get_resource_schema for the type. ` +
        `For "${CONNECTION}", \`data\` is the connection body: { fromId, toId, type: "push"|"sync", data }.`,
      inputSchema: {
        workspaceId: z.string(),
        type: z.string().describe(`Resource type: one of ${typeList}`),
        data: z.record(z.any()).describe("Resource payload (see get_resource_schema)"),
      },
    },
    async ({ workspaceId, type, data }, ctx) =>
      run("create_resource", () => {
        const user = principalFromAuth(ctx.authInfo);
        if (type === CONNECTION) {
          return service.upsertLink(user, workspaceId, data as any, { strict: true });
        }
        // MCP callers pass `data` without an id; mint one server-side.
        return service.create(user, workspaceId, type, data, { generateId: true });
      })
  );

  sdkServer.registerTool(
    "update_resource",
    {
      title: "Update resource",
      description:
        `Update a configuration resource by id (merged into the existing object). type ∈ {${typeList}}. ` +
        `For "${CONNECTION}", \`data\` is the connection body and the link is upserted by id.`,
      inputSchema: {
        workspaceId: z.string(),
        type: z.string().describe(`Resource type: one of ${typeList}`),
        id: z.string().describe("Resource id"),
        data: z.record(z.any()).describe("Fields to update (see get_resource_schema)"),
      },
    },
    async ({ workspaceId, type, id, data }, ctx) =>
      run("update_resource", async () => {
        const user = principalFromAuth(ctx.authInfo);
        if (type === CONNECTION) {
          return service.updateLink(user, workspaceId, id, data as any);
        }
        await service.update(user, workspaceId, type, id, data);
        return { id, updated: true };
      })
  );

  sdkServer.registerTool(
    "delete_resource",
    {
      title: "Delete resource",
      description: `Delete a configuration resource by id (soft delete). type ∈ {${typeList}}.`,
      inputSchema: {
        workspaceId: z.string(),
        type: z.string().describe(`Resource type: one of ${typeList}`),
        id: z.string().describe("Resource id"),
      },
    },
    async ({ workspaceId, type, id }, ctx) =>
      run("delete_resource", async () => {
        const user = principalFromAuth(ctx.authInfo);
        if (type === CONNECTION) {
          return service.deleteLink(user, workspaceId, { id });
        }
        const deleted = await service.delete(user, workspaceId, type, id);
        return deleted ? { id, deleted: true } : { id, deleted: false, reason: "not found" };
      })
  );

  // ─── Observability: events log ────────────────────────────────────────────

  sdkServer.registerTool(
    "list_event_sources",
    {
      title: "List event sources",
      description:
        `List the sources (actors) you can pass as \`source\` to query_events, for a workspace. ` +
        `Optionally narrow by \`type\`: "incoming" → streams; "function"/"bulker_batch"/"bulker_stream" → ` +
        `connections, destinations, profile builders; "dead-letter" adds the "all" sentinel.`,
      inputSchema: {
        workspaceId: z.string(),
        type: z.string().optional().describe(`Optional view to scope sources: one of ${eventTypeList}`),
      },
    },
    async ({ workspaceId, type }, ctx) =>
      run("list_event_sources", () => eventsLog.listEventSources(principalFromAuth(ctx.authInfo), workspaceId, type))
  );

  sdkServer.registerTool(
    "query_events",
    {
      title: "Query events",
      description:
        `Read recent event-log records for a workspace. type ∈ {${eventTypeList}}. ` +
        `\`source\` filters to one actor (a stream id for "incoming"; a connection id for "function"/"bulker_*"; ` +
        `any actor or "all" for "dead-letter"). Omit \`source\` (or pass "all") to query across ALL the ` +
        `workspace's sources. Use list_event_sources to discover ids. Results are newest-first, capped by \`limit\`.`,
      inputSchema: {
        workspaceId: z.string(),
        type: z.string().describe(`Log type: one of ${eventTypeList}`),
        source: z.string().optional().describe('Source/actor id, or "all"/omitted for all sources'),
        limit: z.number().optional().describe("Max records (default 50, max 1000)"),
        levels: z.string().optional().describe('Comma-separated log levels, e.g. "error,warn" (events_log types only)'),
        start: z.string().datetime({ offset: true }).optional().describe("ISO timestamp — only records at/after this"),
        end: z.string().datetime({ offset: true }).optional().describe("ISO timestamp — only records before this"),
        search: z.string().optional().describe("Substring match on the record body"),
      },
    },
    async ({ workspaceId, type, source, limit, levels, start, end, search }, ctx) =>
      run("query_events", () => {
        const user = principalFromAuth(ctx.authInfo);
        if (type === "dead-letter") {
          return eventsLog.queryDeadLetter(user, workspaceId, { source, limit, start, end, search });
        }
        return eventsLog.queryEventsLog(user, workspaceId, type, { source, limit, levels, start, end, search });
      })
  );
}
