import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../lib/schema";

vi.mock("../lib/api", async importOriginal => ({
  ...(await importOriginal<any>()),
  verifyAccess: vi.fn(async () => undefined),
}));

import { ReportsService } from "../lib/server/reports-service";

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
    profileBuilder: {
      findFirst: vi.fn(async () => null),
      ...overrides.profileBuilder,
    },
  } as any;
}

function makePgPool(rows: any[] = []) {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  return { pgPool: { query } as any, query };
}

function makeClickhouse(data: any[] = []) {
  const query = vi.fn(async () => ({ json: async () => ({ data }) }));
  return { clickhouse: { query } as any, query };
}

function makeService(opts: { prisma?: any; pg?: any; ch?: any } = {}) {
  return new ReportsService({
    prisma: opts.prisma ?? makePrisma(),
    pgPool: opts.pg ?? makePgPool().pgPool,
    clickhouse: opts.ch ?? makeClickhouse().clickhouse,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("ReportsService.eventStat", () => {
  it("scopes to the workspace and converts periods to ISO", async () => {
    const { clickhouse, query } = makeClickhouse([
      { period: "2026-07-01 00:00:00", connectionId: "c1", status: "success", events: "10" },
    ]);
    const svc = makeService({ ch: clickhouse });
    const res = await svc.eventStat(user, "ws1", { granularity: "hour" });
    expect(query.mock.calls[0][0].query_params).toEqual(
      expect.objectContaining({ workspace: "ws1", granularity: "hour" })
    );
    expect(res.rows).toEqual([
      expect.objectContaining({ period: "2026-07-01T00:00:00Z", workspaceId: "ws1", connectionId: "c1" }),
    ]);
  });

  it("defaults the period to the last month", async () => {
    const svc = makeService();
    const res = await svc.eventStat(user, "ws1");
    const spanDays = (new Date(res.end).getTime() - new Date(res.start).getTime()) / 86_400_000;
    expect(spanDays).toBeGreaterThanOrEqual(28);
    expect(spanDays).toBeLessThanOrEqual(31);
  });
});

describe("ReportsService.syncStat", () => {
  it("returns the active-syncs count for the period", async () => {
    const { pgPool, query } = makePgPool([{ activeSyncs: "4" }]);
    const svc = makeService({ pg: pgPool });
    const res = await svc.syncStat(user, "ws1", { start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" });
    expect(res.activeSyncs).toBe("4");
    expect(query.mock.calls[0][1]).toEqual(["ws1", "2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"]);
  });
});

describe("ReportsService.profileBuilderStats", () => {
  it("404s for a profile builder outside the workspace", async () => {
    const svc = makeService();
    await expect(svc.profileBuilderStats(user, "ws1", { profileBuilderId: "ghost" })).rejects.toThrow(/not found/);
  });

  it("defaults the version to the builder's current one and parses numbers", async () => {
    const prisma = makePrisma({ profileBuilder: { findFirst: vi.fn(async () => ({ id: "pb-1", version: 5 })) } });
    const { pgPool, query } = makePgPool([
      {
        lastTimestamp: new Date(),
        startedAt: new Date(),
        totalUsers: "100",
        processedUsers: "40",
        errorUsers: "1",
        speed: "2.5",
      },
    ]);
    const svc = makeService({ prisma, pg: pgPool });
    const res = await svc.profileBuilderStats(user, "ws1", { profileBuilderId: "pb-1" });
    expect(query.mock.calls[0][1]).toEqual(["pb-1", 5]);
    expect(res).toEqual(
      expect.objectContaining({ status: "ready", version: 5, totalUsers: 100, processedUsers: 40, speed: 2.5 })
    );
  });

  it("reports unknown when no state rows exist", async () => {
    const prisma = makePrisma({ profileBuilder: { findFirst: vi.fn(async () => ({ id: "pb-1", version: 2 })) } });
    const svc = makeService({ prisma, pg: makePgPool([]).pgPool });
    const res = await svc.profileBuilderStats(user, "ws1", { profileBuilderId: "pb-1", version: 1 });
    expect(res).toEqual({ status: "unknown", version: 1 });
  });
});
