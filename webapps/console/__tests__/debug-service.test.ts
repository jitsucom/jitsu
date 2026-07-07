import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SessionUser } from "../lib/schema";

// Partial mocks: access checks and schema parsing/filtering are exercised elsewhere; here we
// test the service's own logic (config loading, code/settings defaulting, dispatch payloads).
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
vi.mock("../lib/schema/config-objects", async importOriginal => ({
  ...(await importOriginal<any>()),
  parseObject: vi.fn((_type: string, obj: any) => obj),
  getConfigObjectType: vi.fn(() => ({ inputFilter: async (o: any) => o })),
}));
vi.mock("../lib/server/http-agent", () => ({
  httpAgent: () => undefined,
  httpsAgent: () => undefined,
}));
vi.mock("juava", async importOriginal => ({
  ...(await importOriginal<any>()),
  rpc: vi.fn(async () => ({ store: {}, logs: [] })),
}));
vi.mock("../lib/server/serverEnv", () => {
  const env: any = {
    BULKER_URL: "http://bulker",
    BULKER_AUTH_KEY: "bk",
    FUNCTIONS_SERVER_URL_TEMPLATE: "http://fs-${workspaceId}",
    ROTOR_AUTH_KEY: "rk",
    ROTOR_URL: "http://rotor",
  };
  return { getServerEnv: () => env, __env: env };
});

import { DebugService } from "../lib/server/debug-service";
import { rpc } from "juava";
import * as serverEnv from "../lib/server/serverEnv";

const env: any = (serverEnv as any).__env;

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
      ...overrides.workspace,
    },
    configurationObject: {
      findFirst: vi.fn(async () => null),
      ...overrides.configurationObject,
    },
    profileBuilder: {
      findFirst: vi.fn(async () => null),
      ...overrides.profileBuilder,
    },
    functionsServer: {
      findMany: vi.fn(async () => [{ class: "free", deploymentId: "dep-1" }]),
      ...overrides.functionsServer,
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("DebugService.testConnection", () => {
  it("requires either config or id", async () => {
    const svc = new DebugService({ prisma: makePrisma() });
    await expect(svc.testConnection(user, "ws1", "destination", {})).rejects.toThrow(/config.*or.*id/);
  });

  it("loads an existing destination by id and posts it to bulker /test", async () => {
    const prisma = makePrisma({
      configurationObject: {
        findFirst: vi.fn(async () => ({ id: "dst-1", config: { destinationType: "postgres", host: "h" } })),
      },
    });
    const svc = new DebugService({ prisma });
    const res = await svc.testConnection(user, "ws1", "destination", { id: "dst-1" });
    expect(res).toEqual({ ok: true });
    const [url, options] = vi.mocked(fetch).mock.calls[0] as any[];
    expect(url).toBe("http://bulker/test");
    expect(options.headers.Authorization).toBe("Bearer bk");
    const payload = JSON.parse(options.body);
    expect(payload).toEqual(
      expect.objectContaining({ id: "dst-1", workspaceId: "ws1", type: "destination", host: "h" })
    );
  });

  it("404s for an id outside the workspace", async () => {
    const svc = new DebugService({ prisma: makePrisma() });
    await expect(svc.testConnection(user, "ws1", "destination", { id: "ghost" })).rejects.toThrow(/does not exist/);
  });
});

describe("DebugService.runFunction", () => {
  it("loads the stored draft when code is omitted and posts to the workspace functions server", async () => {
    const prisma = makePrisma({
      configurationObject: {
        findFirst: vi.fn(async () => ({ id: "fn-1", config: { name: "My fn", code: "old", draft: "new" } })),
      },
    });
    const svc = new DebugService({ prisma });
    await svc.runFunction(user, "ws1", { functionId: "fn-1", event: { type: "page" } });
    const [url, opts] = vi.mocked(rpc).mock.calls[0] as any[];
    expect(url).toBe("http://fs-dep-1/udfrun");
    expect(opts.body).toEqual(
      expect.objectContaining({ functionId: "fn-1", functionName: "My fn", code: "new", workspaceId: "ws1" })
    );
    expect(opts.headers.Authorization).toBe("Bearer rk");
  });

  it("404s when code is omitted and the function does not exist", async () => {
    const svc = new DebugService({ prisma: makePrisma() });
    await expect(svc.runFunction(user, "ws1", { functionId: "ghost", event: {} })).rejects.toThrow(/does not exist/);
  });

  it("reports FunctionRuntimeNotReady when the workspace has no functions server", async () => {
    const prisma = makePrisma({ functionsServer: { findMany: vi.fn(async () => []) } });
    const svc = new DebugService({ prisma });
    const res = await svc.runFunction(user, "ws1", { functionId: "fn-1", event: {}, code: "export default e => e" });
    expect(res.error?.name).toBe("FunctionRuntimeNotReady");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("prefers the highest-priority deployment class", async () => {
    const prisma = makePrisma({
      functionsServer: {
        findMany: vi.fn(async () => [
          { class: "free", deploymentId: "dep-free" },
          { class: "premium", deploymentId: "dep-premium" },
        ]),
      },
    });
    const svc = new DebugService({ prisma });
    await svc.runFunction(user, "ws1", { functionId: "fn-1", event: {}, code: "x" });
    expect(vi.mocked(rpc).mock.calls[0][0]).toBe("http://fs-dep-premium/udfrun");
  });
});

describe("DebugService.runProfileBuilder", () => {
  const pb = {
    profileBuilder: {
      findFirst: vi.fn(async () => ({
        id: "pb-1",
        name: "PB",
        version: 3,
        connectionOptions: { tableName: "profiles", variables: {} },
        functions: [{ function: { config: { code: "pb code", draft: "pb draft" } } }],
      })),
    },
  };

  it("404s when the profile builder does not exist", async () => {
    const svc = new DebugService({ prisma: makePrisma() });
    await expect(svc.runProfileBuilder(user, "ws1", { profileBuilderId: "ghost", events: [] })).rejects.toThrow(
      /does not exist/
    );
  });

  it("defaults code, settings, and version from the stored profile builder", async () => {
    const svc = new DebugService({ prisma: makePrisma(pb) });
    await svc.runProfileBuilder(user, "ws1", { profileBuilderId: "pb-1", events: [{ type: "identify" }] });
    const [url, opts] = vi.mocked(rpc).mock.calls[0] as any[];
    expect(url).toBe("http://fs-dep-1/profileudfrun");
    expect(opts.body).toEqual(
      expect.objectContaining({
        id: "pb-1",
        version: 3,
        code: "pb draft",
        settings: { tableName: "profiles", variables: {} },
        workspaceId: "ws1",
      })
    );
  });

  it("falls back to ROTOR_URL when no functions-server template is configured", async () => {
    const template = env.FUNCTIONS_SERVER_URL_TEMPLATE;
    env.FUNCTIONS_SERVER_URL_TEMPLATE = undefined;
    try {
      const svc = new DebugService({ prisma: makePrisma(pb) });
      await svc.runProfileBuilder(user, "ws1", { profileBuilderId: "pb-1", events: [] });
      expect(vi.mocked(rpc).mock.calls[0][0]).toBe("http://rotor/profileudfrun");
    } finally {
      env.FUNCTIONS_SERVER_URL_TEMPLATE = template;
    }
  });
});
