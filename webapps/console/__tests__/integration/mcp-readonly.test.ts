import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { randomId } from "juava";
import { deps, seedWorkspace } from "./support/harness";
import { AuthChecker } from "../../lib/server/mcp-server/auth";
import { OAuthHandlers } from "../../lib/server/mcp-server/oauth";
import { verifyAccessWithRole } from "../../lib/api";
import { registerTools } from "../../lib/server/mcp-server/tools";

// Approving an OAuth client needs a signed-in session (an API key is refused), and tests have no browser session, so
// getUser returns the session user set by connect().
const session = vi.hoisted(() => ({ user: undefined as any }));
vi.mock("../../lib/api", async importOriginal => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, getUser: async (res: any, req: any) => session.user ?? actual.getUser(res, req) };
});

// The log of the tools is captured, to check that a refused call leaves a line an operator can see.
const logged = vi.hoisted(() => ({ lines: [] as { level: string; message: string }[] }));
vi.mock("../../lib/server/log", async importOriginal => {
  const actual = await importOriginal<typeof import("../../lib/server/log")>();
  const chain = (level: string): any =>
    new Proxy(() => {}, {
      get: (_t, prop) =>
        prop === "log" ? (message: string) => logged.lines.push({ level, message }) : () => chain(level),
    });
  return {
    ...actual,
    getServerLog: () => ({
      atDebug: () => chain("debug"),
      atInfo: () => chain("info"),
      atWarn: () => chain("warn"),
      atError: () => chain("error"),
    }),
  };
});

// JITSU-265: an MCP client got the full account. Read-only approval gives its tokens the analyst role.

function memoryKv(): any {
  const m = new Map<string, any>();
  return {
    get: async (k: string) => m.get(k),
    set: async (k: string, v: any) => (m.set(k, v), true),
    del: async (k: string) => m.delete(k),
    getDel: async (k: string) => {
      const v = m.get(k);
      m.delete(k);
      return v;
    },
    scanByPrefix: async () => [],
  };
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, any>,
    setHeader(n: string, v: any) {
      this.headers[n] = v;
    },
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
  };
  return res;
}

const req = (body: any, headers: Record<string, string> = {}) =>
  ({ method: "POST", headers, socket: {}, query: {}, cookies: {}, body } as any);

async function connect(readOnly: boolean) {
  const { user, workspace } = await seedWorkspace(); // owner of the workspace
  session.user = { ...user, authType: "next-auth" };
  const handlers = new OAuthHandlers({
    prisma: deps().prisma,
    kv: memoryKv(),
    accessTokenTtlSec: 3600,
    refreshTokenTtlDays: 30,
  });

  const redirect = "https://client.example/callback";
  const registered = makeRes();
  await handlers.register(req({ client_name: "Some client", redirect_uris: [redirect] }), registered);
  const { client_id, client_secret } = registered.body;

  const verifier = randomId({ digits: 64, strongRandom: true });
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const approved = makeRes();
  await handlers.approve(
    req({
      client_id,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: "S256",
      response_type: "code",
      ...(readOnly ? { read_only: true } : {}),
    }),
    approved
  );
  expect(approved.statusCode).toBe(200);
  const code = new URL(approved.body.redirect_to).searchParams.get("code")!;

  const tokens = makeRes();
  await handlers.token(
    req({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
      client_id,
      client_secret,
    }),
    tokens
  );
  expect(tokens.statusCode).toBe(200);

  const auth = await new AuthChecker(deps().prisma, () => {}).requireAccessToken(
    { headers: { authorization: `Bearer ${tokens.body.access_token}` } } as any,
    makeRes()
  );
  return { auth: auth!, user, workspace, handlers, tokens: tokens.body, client_id, client_secret };
}

const asMcpUser = (auth: any, user: any) => ({
  ...user,
  authType: "mcp",
  tokenRole: auth.extra.role,
  tokenWorkspaceId: auth.extra.workspaceId,
});

// Calls the registered tool handlers the way the MCP SDK would, with the auth info of a connected client.
function registeredTools(syncs: Record<string, any>) {
  const handlers = new Map<string, (args: any, extra: any) => Promise<any>>();
  const sdkServer: any = { registerTool: (name: string, _config: any, cb: any) => handlers.set(name, cb) };
  registerTools(sdkServer, {
    syncs,
    service: { resourceTypes: () => [] },
    eventsLog: {},
    debug: {},
    reports: {},
    auditLog: {},
    req: {},
  } as any);
  return handlers;
}

// Every tool as the SDK would receive it: its name and annotations. Tool bodies are not run here.
function registeredConfigs() {
  const configs = new Map<string, any>();
  const sdkServer: any = { registerTool: (name: string, config: any) => configs.set(name, config) };
  registerTools(sdkServer, {
    syncs: {},
    service: { resourceTypes: () => [] },
    eventsLog: {},
    debug: {},
    reports: {},
    auditLog: {},
    req: {},
  } as any);
  return configs;
}

// A dependency that records every method called on it: a refused tool must touch none of them.
function recording(calls: string[], label: string, extra: Record<string, any> = {}): any {
  return new Proxy(extra, {
    get: (target, prop: string) =>
      prop in target
        ? target[prop]
        : (...args: any[]) => {
            calls.push(`${label}.${prop}`);
            return undefined;
          },
  });
}

describe("MCP tool split between read-only and the rest", () => {
  // The line a read-only grant draws. Adding a tool makes this fail until the new tool is put on one side on purpose.
  const READ_ONLY_TOOLS = [
    "get_audit_log",
    "get_event_stat",
    "get_profile_builder_stats",
    "get_resource",
    "get_resource_schema",
    "get_source_check_result",
    "get_sync_logs",
    "get_sync_state",
    "get_sync_stat",
    "list_event_sources",
    "list_resources",
    "list_sync_tasks",
    "list_workspaces",
    "query_events",
  ];
  const OTHER_TOOLS = [
    "cancel_sync",
    "check_source_credentials",
    "create_resource",
    "delete_resource",
    "discover_streams",
    "get_connector_spec",
    "reset_sync_state",
    "run_function",
    "run_profile_builder",
    "run_sync",
    "test_connection",
    "update_resource",
  ];

  it("pins the 14 read-only tools and the 12 others by name", () => {
    const configs = registeredConfigs();
    const readOnly = [...configs].filter(([, c]) => c.annotations?.readOnlyHint === true).map(([n]) => n);
    const other = [...configs].filter(([, c]) => c.annotations?.readOnlyHint !== true).map(([n]) => n);
    expect(readOnly.sort()).toEqual([...READ_ONLY_TOOLS].sort());
    expect(other.sort()).toEqual([...OTHER_TOOLS].sort());
  });

  it.each(OTHER_TOOLS)("refuses %s to a read-only token before any service is reached", async name => {
    const calls: string[] = [];
    const handlers = new Map<string, (args: any, extra: any) => Promise<any>>();
    const sdkServer: any = { registerTool: (n: string, _c: any, cb: any) => handlers.set(n, cb) };
    registerTools(sdkServer, {
      syncs: recording(calls, "syncs"),
      service: recording(calls, "service", { resourceTypes: () => [] }),
      eventsLog: recording(calls, "eventsLog"),
      debug: recording(calls, "debug"),
      reports: recording(calls, "reports"),
      auditLog: recording(calls, "auditLog"),
      req: {},
    } as any);
    const args = { workspaceId: "w1", syncId: "s1", type: "function", id: "x", code: "x", debug: {} };
    const result = await handlers.get(name)!(args, { authInfo: { extra: { userId: "u1", role: "analyst" } } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error \(403\): /);
    expect(calls).toEqual([]);
  });
});

describe("a refused call is logged and says whose role refused it", () => {
  it("names the tool and the role in the answer and in a log line, without the arguments", async () => {
    logged.lines.length = 0;
    const result = await registeredTools({}).get("run_sync")!(
      { workspaceId: "w1", syncId: "secret-sync-id" },
      { authInfo: { extra: { userId: "u1", role: "analyst" } } }
    );
    const text = result.content[0].text;
    expect(text).toContain("'run_sync'");
    expect(text).toMatch(/role of this connection \(analyst\)/);
    expect(text).not.toMatch(/this connection is read-only/);
    const refusals = logged.lines.filter(l => /run_sync/.test(l.message) && /refus/i.test(l.message));
    expect(refusals).toHaveLength(1);
    expect(refusals[0].message).toContain("analyst");
    expect(refusals[0].message).not.toContain("secret-sync-id");
  });

  it("logs nothing for an allowed call", async () => {
    logged.lines.length = 0;
    await registeredTools({ getSyncState: vi.fn(async () => ({ state: {} })) }).get("get_sync_state")!(
      { workspaceId: "w1", syncId: "s1" },
      { authInfo: { extra: { userId: "u1", role: "analyst" } } }
    );
    expect(logged.lines.filter(l => /refus/i.test(l.message))).toEqual([]);
  });
});

describe("MCP read-only tools", () => {
  const ctx = (role: string | null) => ({
    authInfo: { extra: { userId: "u1", role } },
  });
  const args = { workspaceId: "w1", syncId: "s1" };

  it.each(["reset_sync_state", "run_sync", "cancel_sync", "check_source_credentials", "run_function"])(
    "refuses %s to a read-only token before it reaches the service",
    async name => {
      const syncs = { resetSyncState: vi.fn(), runSync: vi.fn(), cancelSync: vi.fn(), triggerSourceCheck: vi.fn() };
      const result = await registeredTools(syncs).get(name)!(args, ctx("analyst"));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Error \(403\): .*read-only/);
      for (const fn of Object.values(syncs)) expect(fn).not.toHaveBeenCalled();
    }
  );

  it("still lets a read-only token call the read tools", async () => {
    const syncs = { getSyncState: vi.fn(async () => ({ state: {} })) };
    const result = await registeredTools(syncs).get("get_sync_state")!(args, ctx("analyst"));
    expect(result.isError).toBeUndefined();
    expect(syncs.getSyncState).toHaveBeenCalled();
  });

  it("does not limit a token without a role, nor an editor", async () => {
    for (const role of [null, "editor", "owner"]) {
      const syncs = { resetSyncState: vi.fn(async () => ({})) };
      const result = await registeredTools(syncs).get("reset_sync_state")!(args, ctx(role));
      expect(result.isError).toBeUndefined();
      expect(syncs.resetSyncState).toHaveBeenCalledOnce();
    }
  });
});

describe("MCP read-only approval", () => {
  it("gives the tokens the analyst role, which cannot change anything", async () => {
    const { auth, user, workspace } = await connect(true);
    expect(auth.extra!.role).toBe("analyst");
    const mcpUser = asMcpUser(auth, user);
    await expect(verifyAccessWithRole(mcpUser, workspace.id, "readEntities")).resolves.toBeDefined();
    await expect(verifyAccessWithRole(mcpUser, workspace.id, "editEntities")).rejects.toMatchObject({ status: 403 });
    await expect(verifyAccessWithRole(mcpUser, workspace.id, "deleteEntities")).rejects.toMatchObject({ status: 403 });
  });

  it("keeps the role when the refresh token is used", async () => {
    const { handlers, tokens, client_id, client_secret } = await connect(true);
    const refreshed = makeRes();
    await handlers.token(
      req({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id, client_secret }),
      refreshed
    );
    expect(refreshed.statusCode).toBe(200);
    const auth = await new AuthChecker(deps().prisma, () => {}).requireAccessToken(
      { headers: { authorization: `Bearer ${refreshed.body.access_token}` } } as any,
      makeRes()
    );
    expect(auth!.extra!.role).toBe("analyst");
  });

  it("without the read-only choice nothing changes", async () => {
    const { auth, user, workspace } = await connect(false);
    expect(auth.extra!.role).toBeNull();
    await expect(verifyAccessWithRole(asMcpUser(auth, user), workspace.id, "editEntities")).resolves.toBeDefined();
  });
});
