import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../lib/schema";

// The service delegates access checks, audit logging, telemetry and sync scheduling to
// shared helpers that reach for the db.prisma() singleton. Mock those so we can unit-test
// the service's own logic (id minting, type validation, payload shaping, not-found paths)
// against a fake prisma — no database required.
// Partial mocks: keep the modules' other exports intact (they're imported transitively
// by the schema/route layer), override only what the service calls for access/audit.
vi.mock("../lib/api", async importOriginal => ({
  ...(await importOriginal<any>()),
  verifyAccess: vi.fn(async () => undefined),
  verifyAccessWithRole: vi.fn(async () => ({
    role: "owner",
    editEntities: true,
    deleteEntities: true,
    readEntities: true,
  })),
}));
vi.mock("../lib/server/audit-log", async importOriginal => ({
  ...(await importOriginal<any>()),
  configObjectAuditLog: vi.fn(async () => undefined),
}));
vi.mock("../lib/server/telemetry", async importOriginal => ({
  ...(await importOriginal<any>()),
  trackTelemetryEvent: vi.fn(async () => undefined),
  withProductAnalytics: vi.fn(async () => undefined),
}));
vi.mock("../lib/server/sync", async importOriginal => ({
  ...(await importOriginal<any>()),
  scheduleSync: vi.fn(async () => undefined),
  validateSyncSchedule: vi.fn(() => undefined),
}));

import { ConfigObjectsService } from "../lib/server/config-objects-service";

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
    workspace: {
      findFirst: vi.fn(async () => ({ id: "ws1", name: "WS" })),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      ...overrides.workspace,
    },
    configurationObject: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: data.id })),
      update: vi.fn(async () => ({})),
      ...overrides.configurationObject,
    },
    configurationObjectLink: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      ...overrides.configurationObjectLink,
    },
    userProfile: { findUnique: vi.fn(async () => ({ id: "user-1", admin: false })), ...overrides.userProfile },
    workspaceAccess: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      ...overrides.workspaceAccess,
    },
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("ConfigObjectsService", () => {
  it("rejects unknown resource types", async () => {
    const svc = new ConfigObjectsService({ prisma: makePrisma() });
    await expect(svc.list(user, "ws1", "bogus")).rejects.toThrow(/Unknown resource type/);
  });

  it("create mints an id (generateId) and strips id/workspaceId from stored config", async () => {
    const prisma = makePrisma();
    const svc = new ConfigObjectsService({ prisma });
    const res = await svc.create(user, "ws1", "domain", { name: "example.com" }, { generateId: true });

    expect(prisma.configurationObject.create).toHaveBeenCalledOnce();
    const arg = prisma.configurationObject.create.mock.calls[0][0];
    expect(arg.data.type).toBe("domain");
    expect(arg.data.id).toBeTruthy();
    expect(res.id).toBe(arg.data.id);
    // stored config carries the type but not id/workspaceId (those live in columns)
    expect(arg.data.config.id).toBeUndefined();
    expect(arg.data.config.workspaceId).toBeUndefined();
    expect(arg.data.config.name).toBe("example.com");
  });

  it("create without an id and no generateId fails validation (HTTP contract)", async () => {
    const prisma = makePrisma();
    const svc = new ConfigObjectsService({ prisma });
    // The HTTP route requires the client to send an id; a missing one must stay a
    // validation error rather than get an implicitly minted id.
    await expect(svc.create(user, "ws1", "domain", { name: "example.com" })).rejects.toThrow(/validate schema/);
    expect(prisma.configurationObject.create).not.toHaveBeenCalled();
  });

  it("delete returns null when the object is missing (idempotent)", async () => {
    const svc = new ConfigObjectsService({ prisma: makePrisma() });
    await expect(svc.delete(user, "ws1", "destination", "nope")).resolves.toBeNull();
  });

  it("list maps stored rows to objects with id/type/workspaceId", async () => {
    const prisma = makePrisma({
      configurationObject: {
        findMany: vi.fn(async () => [{ id: "d1", workspaceId: "ws1", config: { name: "dest" }, updatedAt: null }]),
      },
    });
    const svc = new ConfigObjectsService({ prisma });
    const objects = await svc.list(user, "ws1", "destination");
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ id: "d1", type: "destination", workspaceId: "ws1", name: "dest" });
  });

  it("listWorkspaces uses workspaceAccess for non-admins", async () => {
    const prisma = makePrisma({
      userProfile: { findUnique: vi.fn(async () => ({ id: "user-1", admin: false })) },
      workspaceAccess: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [{ workspace: { id: "ws1", name: "WS", slug: "ws" } }]),
      },
    });
    const svc = new ConfigObjectsService({ prisma });
    const res = await svc.listWorkspaces(user);
    expect(res).toEqual({
      workspaces: [{ id: "ws1", name: "WS", slug: "ws" }],
      total: 1,
      limit: 100,
      offset: 0,
      hasMore: false,
    });
    expect(prisma.workspace.findMany).not.toHaveBeenCalled();
  });

  it("listWorkspaces lists all workspaces for admins", async () => {
    const prisma = makePrisma({
      userProfile: { findUnique: vi.fn(async () => ({ id: "user-1", admin: true })) },
      workspace: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [{ id: "ws1", name: "WS", slug: "ws" }]),
      },
    });
    const svc = new ConfigObjectsService({ prisma });
    const res = await svc.listWorkspaces(user);
    expect(res.workspaces).toEqual([{ id: "ws1", name: "WS", slug: "ws" }]);
    expect(prisma.workspaceAccess.findMany).not.toHaveBeenCalled();
  });

  it("listWorkspaces caps the page at 100 and reports hasMore", async () => {
    const findMany = vi.fn(async () => [{ id: "ws1", name: "WS", slug: "ws" }]);
    const prisma = makePrisma({
      userProfile: { findUnique: vi.fn(async () => ({ id: "user-1", admin: true })) },
      workspace: { count: vi.fn(async () => 250), findMany },
    });
    const svc = new ConfigObjectsService({ prisma });
    const res = await svc.listWorkspaces(user, { limit: 999, offset: 0 });
    expect(res.limit).toBe(100);
    expect(res.total).toBe(250);
    expect(res.hasMore).toBe(true);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 100 }));
  });

  it("get constrains the lookup by type (so a wrong-type id can't run the wrong filter)", async () => {
    const prisma = makePrisma();
    const svc = new ConfigObjectsService({ prisma });
    await expect(svc.get(user, "ws1", "destination", "id-1")).rejects.toThrow(/does not exist/);
    expect(prisma.configurationObject.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: "ws1", id: "id-1", type: "destination", deleted: false },
    });
  });

  it("updateLink targets the link by id and rejects a from/to that doesn't match", async () => {
    const existing = { id: "lnk", workspaceId: "ws1", fromId: "a", toId: "b", type: "push", data: {} };
    const update = vi.fn(async () => ({ id: "lnk" }));
    const prisma = makePrisma({
      configurationObjectLink: { findFirst: vi.fn(async () => existing), update },
    });
    const svc = new ConfigObjectsService({ prisma });

    await expect(svc.updateLink(user, "ws1", "lnk", { fromId: "x", data: {} })).rejects.toThrow(/does not match/);
    expect(update).not.toHaveBeenCalled();

    const res = await svc.updateLink(user, "ws1", "lnk", { data: { batchSize: 10 } });
    expect(res).toEqual({ id: "lnk", updated: true });
    expect(update).toHaveBeenCalledWith({ where: { id: "lnk" }, data: { data: { batchSize: 10 } } });
  });

  it("updateLink rejects changing a connection's type", async () => {
    const existing = { id: "lnk", workspaceId: "ws1", fromId: "a", toId: "b", type: "push", data: {} };
    const update = vi.fn(async () => ({ id: "lnk" }));
    const prisma = makePrisma({ configurationObjectLink: { findFirst: vi.fn(async () => existing), update } });
    const svc = new ConfigObjectsService({ prisma });
    await expect(svc.updateLink(user, "ws1", "lnk", { type: "sync", data: {} })).rejects.toThrow(
      /type can't be changed/
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("deleteLink by id returns {deleted:false} for a missing connection (no throw)", async () => {
    const update = vi.fn(async () => ({ id: "lnk" }));
    const prisma = makePrisma({ configurationObjectLink: { findFirst: vi.fn(async () => null), update } });
    const svc = new ConfigObjectsService({ prisma });
    await expect(svc.deleteLink(user, "ws1", { id: "nope" })).resolves.toEqual({ deleted: false });
    expect(update).not.toHaveBeenCalled();
  });
});
