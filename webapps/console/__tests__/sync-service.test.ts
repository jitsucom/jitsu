import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../lib/schema";

// Partial-mock the shared helpers that reach for singletons (db, ee, telemetry); keep the
// modules' other exports intact for transitive importers. `rpc` is mocked so no HTTP happens.
vi.mock("../lib/api", async importOriginal => ({
  ...(await importOriginal<any>()),
  verifyAccess: vi.fn(async () => undefined),
}));
// Full stub (no importOriginal): the real module imports the ClickHouse singleton at module
// level, which requires CLICKHOUSE_URL. The service only uses scheduleSync + syncError.
vi.mock("../lib/server/sync", () => ({
  scheduleSync: vi.fn(async () => ({ ok: true, taskId: "task-new" })),
  syncError: vi.fn((_log: any, message: string, error: any) => ({ ok: false, error: `${message}: ${error}` })),
}));
vi.mock("juava", async importOriginal => ({
  ...(await importOriginal<any>()),
  rpc: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../lib/server/serverEnv", () => {
  const env: any = { SYNCCTL_URL: "http://syncctl", SYNCCTL_AUTH_KEY: "sk" };
  return { getServerEnv: () => env, __env: env };
});

import { SyncService } from "../lib/server/sync-service";
import { rpc } from "juava";

const user: SessionUser = {
  internalId: "user-1",
  externalUsername: "u1",
  externalId: "u1",
  loginProvider: "mcp",
  email: "u1@example.com",
  name: "u1",
  authType: "mcp",
  tokenId: "tok-1",
};

function makePrisma(overrides: any = {}) {
  return {
    configurationObject: {
      findFirst: vi.fn(async () => null),
      ...overrides.configurationObject,
    },
    configurationObjectLink: {
      findFirst: vi.fn(async () => null),
      ...overrides.configurationObjectLink,
    },
    source_task: {
      findFirst: vi.fn(async () => null),
      ...overrides.source_task,
    },
    $queryRawUnsafe: overrides.$queryRawUnsafe ?? vi.fn(async () => []),
  } as any;
}

function makePgPool(responses: Array<{ rows: any[]; rowCount?: number }> = []) {
  let i = 0;
  const query = vi.fn(async () => {
    const r = responses[Math.min(i++, Math.max(responses.length - 1, 0))] ?? { rows: [] };
    return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
  });
  return { pgPool: { query } as any, query };
}

function makeClickhouse(rows: any[] = []) {
  const query = vi.fn(async () => ({ json: async () => rows }));
  return { clickhouse: { query } as any, query };
}

function makeService(opts: { prisma?: any; pg?: any; ch?: any } = {}) {
  return new SyncService({
    prisma: opts.prisma ?? makePrisma(),
    pgPool: opts.pg ?? makePgPool().pgPool,
    clickhouse: opts.ch ?? makeClickhouse().clickhouse,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("SyncService.cancelSync", () => {
  it("dispatches /cancel with the package loaded from the sync's service", async () => {
    const prisma = makePrisma({
      configurationObjectLink: {
        findFirst: vi.fn(async () => ({ id: "sync-1", from: { config: { package: "airbyte/source-github" } } })),
      },
    });
    const svc = makeService({ prisma });
    const res = await svc.cancelSync(user, "ws1", { syncId: "sync-1", taskId: "t1" });
    expect(res.ok).toBe(true);
    const [url, opts] = vi.mocked(rpc).mock.calls[0] as any[];
    expect(url).toBe("http://syncctl/cancel");
    expect(opts.query).toEqual(
      expect.objectContaining({ syncId: "sync-1", taskId: "t1", package: "airbyte/source-github" })
    );
  });
});

describe("SyncService.listSyncTasks", () => {
  it("builds the filters in order and scopes by workspace", async () => {
    const $queryRawUnsafe = vi.fn(async () => [{ task_id: "t1" }]);
    const prisma = makePrisma({
      configurationObjectLink: { findFirst: vi.fn(async () => ({ id: "sync-1" })) },
      $queryRawUnsafe,
    });
    const svc = makeService({ prisma });
    const res = await svc.listSyncTasks(user, "ws1", { syncId: "sync-1", status: "SUCCESS" });
    expect(res).toEqual({ ok: true, tasks: [{ task_id: "t1" }] });
    const [sql, ...args] = $queryRawUnsafe.mock.calls[0] as any[];
    expect(sql).toContain('link."workspaceId" = $1');
    expect(sql).toContain("st.sync_id = $2");
    expect(sql).toContain("st.status = $3");
    expect(args).toEqual(["ws1", "sync-1", "SUCCESS"]);
  });
});

describe("SyncService.getSyncLogs", () => {
  it("falls back to Postgres when ClickHouse is empty", async () => {
    const link = { configurationObjectLink: { findFirst: vi.fn(async () => ({ id: "sync-1" })) } };
    const pgRows = [{ timestamp: new Date(), level: "INFO", logger: "sync", message: "from pg" }];
    const { pgPool, query } = makePgPool([{ rows: pgRows }]);
    const svc = makeService({ prisma: makePrisma(link), ch: makeClickhouse([]).clickhouse, pg: pgPool });
    const res = await svc.getSyncLogs(user, "ws1", { syncId: "sync-1", taskId: "t1" });
    expect(res).toEqual({ ok: true, logs: pgRows });
    expect(query.mock.calls[0][1]).toEqual(["t1", "ws1", 200]);
  });
});

describe("SyncService.getConnectorSpec", () => {
  it("returns a cached spec without hitting the controller", async () => {
    const { pgPool } = makePgPool([{ rows: [{ specs: { a: 1 }, error: null }], rowCount: 1 }]);
    const svc = makeService({ pg: pgPool });
    const res = await svc.getConnectorSpec(user, "ws1", { package: "p", version: "v" });
    expect(res).toEqual({ ok: true, specs: { a: 1 } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("kicks off a fetch and stores a pending placeholder on cache miss", async () => {
    const { pgPool, query } = makePgPool([{ rows: [], rowCount: 0 }, { rows: [] }]);
    const svc = makeService({ pg: pgPool });
    const res = await svc.getConnectorSpec(user, "ws1", { package: "p", version: "v" });
    expect(res).toEqual({ ok: false, pending: true });
    expect(vi.mocked(rpc).mock.calls[0][0]).toBe("http://syncctl/spec");
    expect(query.mock.calls[1][0]).toContain("insert into newjitsu.source_spec");
  });
});

describe("SyncService.discoverStreams", () => {
  const service = {
    configurationObject: {
      findFirst: vi.fn(async () => ({
        id: "svc-1",
        workspaceId: "ws1",
        config: { package: "p", version: "v", credentials: { token: "x" } },
      })),
    },
  };

  it("returns a cached catalog without dispatching discover", async () => {
    const { pgPool } = makePgPool([{ rows: [{ status: "SUCCESS", catalog: { streams: [] }, description: null }] }]);
    const svc = makeService({ prisma: makePrisma(service), pg: pgPool });
    const res = await svc.discoverStreams(user, "ws1", { serviceId: "svc-1" });
    expect(res).toEqual({ ok: true, catalog: { streams: [] } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("dispatches discover and marks the catalog RUNNING on cache miss", async () => {
    const { pgPool, query } = makePgPool([{ rows: [], rowCount: 0 }, { rows: [] }]);
    const svc = makeService({ prisma: makePrisma(service), pg: pgPool });
    const res = await svc.discoverStreams(user, "ws1", { serviceId: "svc-1" });
    expect(res).toEqual({ ok: false, pending: true });
    const [url, opts] = vi.mocked(rpc).mock.calls[0] as any[];
    expect(url).toBe("http://syncctl/discover");
    expect(opts.query.storageKey).toMatch(/^ws1_svc-1_/);
    expect(query.mock.calls[1][0]).toContain("INSERT INTO newjitsu.source_catalog");
  });
});

describe("SyncService source check", () => {
  it("triggers the async check and returns a workspace-scoped storageKey", async () => {
    const prisma = makePrisma({
      configurationObject: {
        findFirst: vi.fn(async () => ({
          id: "svc-1",
          workspaceId: "ws1",
          config: { package: "p", version: "v", credentials: { token: "x" } },
        })),
      },
    });
    const svc = makeService({ prisma });
    const res = await svc.triggerSourceCheck(user, "ws1", "svc-1");
    expect(res).toEqual(expect.objectContaining({ ok: false, pending: true }));
    expect(res.storageKey).toMatch(/^ws1_svc-1_/);
    const [url, opts] = vi.mocked(rpc).mock.calls[0] as any[];
    expect(url).toBe("http://syncctl/check");
    expect(opts.body.source.credentials).toEqual({ token: "x" });
  });

  it("rejects polling a storageKey from another workspace", async () => {
    const svc = makeService();
    const res = await svc.getSourceCheckResult(user, "ws1", "ws2_svc_abc");
    expect(res).toEqual({ ok: false, error: "storageKey doesn't belong to the current workspace" });
  });
});

describe("SyncService.resetSyncState", () => {
  const link = { configurationObjectLink: { findFirst: vi.fn(async () => ({ id: "sync-1" })) } };

  it("refuses while the sync is running", async () => {
    const prisma = makePrisma({ ...link, source_task: { findFirst: vi.fn(async () => ({ task_id: "t1" })) } });
    const svc = makeService({ prisma });
    const res = await svc.resetSyncState(user, "ws1", { syncId: "sync-1" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/running/i);
  });

  it("deletes one stream or all and returns the remaining state", async () => {
    const { pgPool, query } = makePgPool([{ rows: [] }, { rows: [{ stream: "other", state: { c: 1 } }] }]);
    const svc = makeService({ prisma: makePrisma(link), pg: pgPool });
    const res = await svc.resetSyncState(user, "ws1", { syncId: "sync-1", stream: "users" });
    expect(query.mock.calls[0][0]).toContain("and stream = $2");
    expect(res.ok).toBe(true);
    expect(res.state).toEqual({ other: JSON.stringify({ c: 1 }, null, 2) });

    vi.clearAllMocks();
    const { pgPool: pg2, query: q2 } = makePgPool([{ rows: [] }, { rows: [] }]);
    const svc2 = makeService({ prisma: makePrisma(link), pg: pg2 });
    await svc2.resetSyncState(user, "ws1", { syncId: "sync-1" });
    expect(q2.mock.calls[0][0]).not.toContain("stream = $2");
  });
});
