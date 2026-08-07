import type { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { NextApiRequest } from "next";
import { z } from "zod";
import { SessionUser } from "../../schema";
import { getResourceJsonSchema } from "../../schema/json-schema";
import { ApiError } from "../../shared/errors";
import { getServerLog } from "../log";
import { isMaintenanceActive, isReadOnly } from "../maintenance";
import { type ConfigObjectsService, WORKSPACES_PAGE_MAX } from "../config-objects-service";
import { type EventsLogService, QUERYABLE_TYPES } from "../events-log-service";
import { type SyncService } from "../sync-service";
import { type DebugService } from "../debug-service";
import { type ReportsService } from "../reports-service";

const log = getServerLog("mcp-tools");

export interface ToolDeps {
  service: ConfigObjectsService;
  eventsLog: EventsLogService;
  syncs: SyncService;
  debug: DebugService;
  reports: ReportsService;
  /** The inbound HTTP request — scheduleSync derives the app base URL and EE auth from it. */
  req: NextApiRequest;
}

// Connections (links) are surfaced through the same generic tools as config objects,
// under the pseudo-type "connection", and dispatched to the link methods.
const CONNECTION = "connection";

// Tool annotations (MCP spec rev 2025-03-26) — clients use these hints to decide when
// to ask the user for confirmation. The spec defaults are the most pessimistic
// (destructiveHint: true, openWorldHint: true), so every tool sets them explicitly.
// openWorldHint marks tools whose execution reaches beyond Jitsu itself
// (connector probes against the user's source/destination, user function code).
// destructive/idempotent hints are spec-meaningless when readOnlyHint is true, but set them
// anyway for clients that apply the pessimistic defaults without checking readOnlyHint first.
const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
// Triggers work but writes only internal caches; safe to repeat; the connector contacts the external system.
const PROBE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
// Executes user function code (which may call anything); persists nothing itself.
const SANDBOXED_RUN: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
// Creates new state; each repeat call creates more (another resource, another task).
const ADDITIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
// Mutates state, but repeat calls have no additional effect.
const IDEMPOTENT_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
// Overwrites or deletes state irreversibly.
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** Build a SessionUser from the MCP auth context (see auth.ts `extra`). */
function principalFromAuth(authInfo: AuthInfo | undefined): SessionUser {
  const extra = (authInfo?.extra ?? {}) as Record<string, any>;
  const userId = extra.userId;
  if (!userId) {
    throw new ApiError("No authenticated user on this MCP session", { status: 401 });
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
  const { service, eventsLog, syncs, debug, reports, req } = deps;
  const types = [...service.resourceTypes().filter(t => t !== "misc"), CONNECTION];
  const typeList = types.join(", ");
  const eventTypeList = QUERYABLE_TYPES.join(", ");

  // Mutating HTTP routes are blocked while writes are disabled (see createRoute
  // in lib/api.ts). MCP tools don't go through createRoute, so enforce the same
  // gate here: any tool not annotated read-only is rejected before its handler
  // runs. Distinguish a time-boxed maintenance window from the permanent
  // read-only switch (JITSU_CONSOLE_READ_ONLY) so the latter isn't mislabeled.
  const register: SdkMcpServer["registerTool"] = (name, config, cb) =>
    sdkServer.registerTool(name, config, (async (args: any, extra: any) => {
      if (!config.annotations?.readOnlyHint && isReadOnly()) {
        const text = isMaintenanceActive()
          ? "Error (503): Jitsu is in maintenance mode; modifications are temporarily disabled."
          : "Error (503): Jitsu is read-only; modifications are disabled.";
        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
          isError: true,
        };
      }
      return (cb as any)(args, extra);
    }) as any);

  register(
    "list_workspaces",
    {
      title: "List workspaces",
      annotations: READ_ONLY,
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

  register(
    "list_resources",
    {
      title: "List resources",
      annotations: READ_ONLY,
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

  register(
    "get_resource",
    {
      title: "Get resource",
      annotations: READ_ONLY,
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
            throw new ApiError(`connection with id ${id} does not exist`, { status: 404 });
          }
          return found;
        }
        return service.get(user, workspaceId, type, id);
      })
  );

  register(
    "get_resource_schema",
    {
      title: "Get resource schema",
      annotations: READ_ONLY,
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

  register(
    "create_resource",
    {
      title: "Create resource",
      annotations: ADDITIVE,
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

  register(
    "update_resource",
    {
      title: "Update resource",
      annotations: DESTRUCTIVE,
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

  register(
    "delete_resource",
    {
      title: "Delete resource",
      annotations: DESTRUCTIVE,
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

  register(
    "list_event_sources",
    {
      title: "List event sources",
      annotations: READ_ONLY,
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

  register(
    "query_events",
    {
      title: "Query events",
      annotations: READ_ONLY,
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

  // ─── Syncs: source → destination lifecycle ─────────────────────────────────

  register(
    "run_sync",
    {
      title: "Run sync",
      annotations: ADDITIVE,
      description:
        'Schedule a sync (a connection of type "sync") to run immediately. Returns the new `taskId`; ' +
        "poll list_sync_tasks with it for status and get_sync_logs for output. If a task is already running " +
        "the call fails and returns `runningTask` — pass ignoreRunning=true to cancel it and start anyway. " +
        "fullSync=true drops the saved cursor and re-syncs from scratch.",
      inputSchema: {
        workspaceId: z.string(),
        syncId: z.string().describe('Connection id of type "sync" (see list_resources with type "connection")'),
        fullSync: z.boolean().optional().describe("Drop saved state and re-sync from scratch"),
        ignoreRunning: z.boolean().optional().describe("Cancel an in-flight task and start a new one"),
      },
    },
    async ({ workspaceId, syncId, fullSync, ignoreRunning }, ctx) =>
      run("run_sync", () =>
        syncs.runSync(principalFromAuth(ctx.authInfo), workspaceId, { syncId, fullSync, ignoreRunning }, req)
      )
  );

  register(
    "cancel_sync",
    {
      title: "Cancel sync",
      annotations: IDEMPOTENT_WRITE,
      description:
        "Cancel a running sync task. Cancellation is asynchronous — poll list_sync_tasks until the task " +
        "status becomes CANCELLED.",
      inputSchema: {
        workspaceId: z.string(),
        syncId: z.string(),
        taskId: z.string().describe("The running task id (from run_sync or list_sync_tasks)"),
      },
    },
    async ({ workspaceId, syncId, taskId }, ctx) =>
      run("cancel_sync", () => syncs.cancelSync(principalFromAuth(ctx.authInfo), workspaceId, { syncId, taskId }))
  );

  register(
    "list_sync_tasks",
    {
      title: "List sync tasks",
      annotations: READ_ONLY,
      description:
        "Up to 50 most recent sync tasks in a workspace, newest first. Filter by `syncId`, a single `taskId` " +
        "(returns `task`), `status` (RUNNING, SUCCESS, PARTIAL, FAILED, CANCELLED, SKIPPED), and a `from`/`to` " +
        "time window.",
      inputSchema: {
        workspaceId: z.string(),
        syncId: z.string().optional(),
        taskId: z.string().optional(),
        status: z.string().optional(),
        from: z.string().datetime({ offset: true }).optional().describe("ISO timestamp — tasks started at/after"),
        to: z.string().datetime({ offset: true }).optional().describe("ISO timestamp — tasks started before"),
      },
    },
    async ({ workspaceId, syncId, taskId, status, from, to }, ctx) =>
      run("list_sync_tasks", () =>
        syncs.listSyncTasks(principalFromAuth(ctx.authInfo), workspaceId, { syncId, taskId, status, from, to })
      )
  );

  register(
    "get_sync_logs",
    {
      title: "Get sync task logs",
      annotations: READ_ONLY,
      description: "Log records of a sync task, newest first (default 200 records, max 5000).",
      inputSchema: {
        workspaceId: z.string(),
        syncId: z.string(),
        taskId: z.string(),
        limit: z.number().int().optional().describe("Max records (default 200, max 5000)"),
      },
    },
    async ({ workspaceId, syncId, taskId, limit }, ctx) =>
      run("get_sync_logs", () =>
        syncs.getSyncLogs(principalFromAuth(ctx.authInfo), workspaceId, { syncId, taskId, limit })
      )
  );

  register(
    "get_connector_spec",
    {
      title: "Get connector spec",
      annotations: PROBE,
      description:
        "JSON schema of a connector package's credentials (the `credentials` field of a service). " +
        "ASYNC: the first call starts a fetch on the sync controller and returns `{ ok: false, pending: true }` — " +
        "call again (every few seconds) until `ok: true` and `specs` is set, or `error` is returned. " +
        "force=true bypasses the cache.",
      inputSchema: {
        workspaceId: z.string(),
        package: z.string().describe('Connector package, e.g. "airbyte/source-github"'),
        version: z.string().describe('Package version, e.g. "latest" or a specific tag'),
        force: z.boolean().optional(),
      },
    },
    async ({ workspaceId, package: pkg, version, force }, ctx) =>
      run("get_connector_spec", () =>
        syncs.getConnectorSpec(principalFromAuth(ctx.authInfo), workspaceId, { package: pkg, version, force })
      )
  );

  register(
    "discover_streams",
    {
      title: "Discover source streams",
      annotations: PROBE,
      description:
        "Ask the connector of an existing service to list its available streams (the catalog used to configure " +
        "a sync). ASYNC: returns `{ ok: false, pending: true }` while running — call again (every few seconds) " +
        "until `ok: true` and `catalog` is set. refresh=true re-fetches an already-cached catalog; force=true " +
        "ignores the cache entirely.",
      inputSchema: {
        workspaceId: z.string(),
        serviceId: z.string().describe("Service (source) id"),
        refresh: z.boolean().optional(),
        force: z.boolean().optional(),
      },
    },
    async ({ workspaceId, serviceId, refresh, force }, ctx) =>
      run("discover_streams", () =>
        syncs.discoverStreams(principalFromAuth(ctx.authInfo), workspaceId, { serviceId, refresh, force })
      )
  );

  register(
    "check_source_credentials",
    {
      title: "Check source credentials",
      annotations: PROBE,
      description:
        "Start an async credentials check for an existing service (source) using its stored config. " +
        "Returns `{ pending: true, storageKey }` — poll get_source_check_result with the storageKey " +
        "until it resolves. For destinations use test_connection instead (synchronous).",
      inputSchema: {
        workspaceId: z.string(),
        serviceId: z.string().describe("Service (source) id"),
      },
    },
    async ({ workspaceId, serviceId }, ctx) =>
      run("check_source_credentials", () =>
        syncs.triggerSourceCheck(principalFromAuth(ctx.authInfo), workspaceId, { serviceId })
      )
  );

  register(
    "get_source_check_result",
    {
      title: "Get source check result",
      annotations: READ_ONLY,
      description:
        "Poll the result of check_source_credentials: `{ ok: true }` on success, `{ ok: false, error }` on " +
        "failure, `{ ok: false, pending: true }` while still running.",
      inputSchema: {
        workspaceId: z.string(),
        storageKey: z.string().describe("The storageKey returned by check_source_credentials"),
      },
    },
    async ({ workspaceId, storageKey }, ctx) =>
      run("get_source_check_result", () =>
        syncs.getSourceCheckResult(principalFromAuth(ctx.authInfo), workspaceId, storageKey)
      )
  );

  register(
    "get_sync_state",
    {
      title: "Get sync state",
      annotations: READ_ONLY,
      description: "The saved incremental cursor of a sync, keyed by stream (empty object if none saved).",
      inputSchema: {
        workspaceId: z.string(),
        syncId: z.string(),
      },
    },
    async ({ workspaceId, syncId }, ctx) =>
      run("get_sync_state", () => syncs.getSyncState(principalFromAuth(ctx.authInfo), workspaceId, syncId))
  );

  register(
    "reset_sync_state",
    {
      title: "Reset sync state",
      annotations: DESTRUCTIVE,
      description:
        "Delete the saved cursor of a sync so the next run re-syncs from scratch. Pass `stream` to reset a " +
        "single stream, omit it to reset all. Fails while the sync is running. Returns the remaining state.",
      inputSchema: {
        workspaceId: z.string(),
        syncId: z.string(),
        stream: z.string().optional().describe("Stream name to reset; omit to reset every stream"),
      },
    },
    async ({ workspaceId, syncId, stream }, ctx) =>
      run("reset_sync_state", () =>
        syncs.resetSyncState(principalFromAuth(ctx.authInfo), workspaceId, { syncId, stream })
      )
  );

  // ─── Testing & debugging ───────────────────────────────────────────────────

  register(
    "test_connection",
    {
      title: "Test connection",
      annotations: PROBE,
      description:
        "Synchronously test destination credentials via bulker. Pass `id` to test an existing destination as " +
        "stored, or `config` (see get_resource_schema) to test an unsaved config — masked secrets in `config` " +
        "are resolved from the object referenced by `config.id`. For services (sources) use " +
        "check_source_credentials instead.",
      inputSchema: {
        workspaceId: z.string(),
        type: z.string().optional().describe('Resource type, default "destination"'),
        id: z.string().optional().describe("Existing object id (used when `config` is omitted)"),
        config: z.record(z.any()).optional().describe("Full config to test (alternative to `id`)"),
      },
    },
    async ({ workspaceId, type, id, config }, ctx) =>
      run("test_connection", () =>
        debug.testConnection(principalFromAuth(ctx.authInfo), workspaceId, type ?? "destination", { id, config })
      )
  );

  register(
    "run_function",
    {
      title: "Run function",
      annotations: SANDBOXED_RUN,
      description:
        "Run a transformation function against a sample event on the workspace's functions server and return " +
        "the result, logs, and store mutations. `code` omitted → the stored function's draft/code is used. " +
        "Nothing is persisted; events are not sent anywhere.",
      inputSchema: {
        workspaceId: z.string(),
        functionId: z.string().describe('Function id (see list_resources with type "function")'),
        event: z.record(z.any()).describe("Sample event to run the function against"),
        code: z.string().optional().describe("Override the function code; omit to run the stored draft/code"),
        variables: z.record(z.any()).optional().describe("Environment variables visible to the function"),
        store: z.record(z.any()).optional().describe("Initial persistent-store contents"),
      },
    },
    async ({ workspaceId, functionId, event, code, variables, store }, ctx) =>
      run("run_function", () =>
        debug.runFunction(principalFromAuth(ctx.authInfo), workspaceId, { functionId, event, code, variables, store })
      )
  );

  register(
    "run_profile_builder",
    {
      title: "Run profile builder",
      annotations: SANDBOXED_RUN,
      description:
        "Run a profile-builder function against sample events and return the computed profile, logs, and store " +
        "mutations. `code`/`settings` omitted → loaded from the stored profile builder. Nothing is persisted.",
      inputSchema: {
        workspaceId: z.string(),
        profileBuilderId: z.string(),
        events: z.array(z.record(z.any())).describe("Sample events of one user to aggregate"),
        code: z.string().optional().describe("Override the profile function code"),
        settings: z.record(z.any()).optional().describe("Override the profile-builder settings"),
        version: z.number().int().optional().describe("Profile-builder version to run; omit for the current one"),
        store: z.record(z.any()).optional().describe("Initial persistent-store contents"),
      },
    },
    async ({ workspaceId, profileBuilderId, events, code, settings, version, store }, ctx) =>
      run("run_profile_builder", () =>
        debug.runProfileBuilder(principalFromAuth(ctx.authInfo), workspaceId, {
          profileBuilderId,
          events,
          code,
          settings,
          version,
          store,
        })
      )
  );

  // ─── Reports & stats ───────────────────────────────────────────────────────

  register(
    "get_event_stat",
    {
      title: "Get event statistics",
      annotations: READ_ONLY,
      description:
        "Event counts per period, connection, stream, destination, and status (success/dropped/error) for a " +
        "workspace. Defaults to the last month with day granularity.",
      inputSchema: {
        workspaceId: z.string(),
        start: z.string().datetime({ offset: true }).optional(),
        end: z.string().datetime({ offset: true }).optional(),
        granularity: z.enum(["day", "hour"]).optional(),
      },
    },
    async ({ workspaceId, start, end, granularity }, ctx) =>
      run("get_event_stat", () =>
        reports.eventStat(principalFromAuth(ctx.authInfo), workspaceId, { start, end, granularity })
      )
  );

  register(
    "get_sync_stat",
    {
      title: "Get sync statistics",
      annotations: READ_ONLY,
      description:
        "Number of distinct source→destination pairs with at least one successful sync task in the period " +
        "(defaults to the last month).",
      inputSchema: {
        workspaceId: z.string(),
        start: z.string().datetime({ offset: true }).optional(),
        end: z.string().datetime({ offset: true }).optional(),
      },
    },
    async ({ workspaceId, start, end }, ctx) =>
      run("get_sync_stat", () => reports.syncStat(principalFromAuth(ctx.authInfo), workspaceId, { start, end }))
  );

  register(
    "get_profile_builder_stats",
    {
      title: "Get profile builder stats",
      annotations: READ_ONLY,
      description:
        "Build progress of a profile-builder version: status (ready/building/unknown), processed/total users, " +
        "and speed. `version` omitted → the current version.",
      inputSchema: {
        workspaceId: z.string(),
        profileBuilderId: z.string(),
        version: z.number().optional(),
      },
    },
    async ({ workspaceId, profileBuilderId, version }, ctx) =>
      run("get_profile_builder_stats", () =>
        reports.profileBuilderStats(principalFromAuth(ctx.authInfo), workspaceId, { profileBuilderId, version })
      )
  );
}
