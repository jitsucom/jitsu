import { beforeEach, describe, expect, it, vi } from "vitest";

// JITSU-284: a connection check of a service whose credentials the editor sent back masked gets the stored values
// restored and then the defaults of the connector spec, which the editor could not add (it checks a copy).

const mocks = vi.hoisted(() => ({
  verifyAccess: vi.fn(),
  rpc: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("../../lib/api", async importOriginal => ({
  ...(await importOriginal<any>()),
  verifyAccess: mocks.verifyAccess,
}));
vi.mock("../../lib/server/db", () => ({
  db: { prisma: () => ({ source_spec: { findUnique: mocks.findUnique } }) },
}));
vi.mock("../../lib/server/clickhouse", () => ({ clickhouse: {} }));
vi.mock("juava", async importOriginal => ({ ...(await importOriginal<any>()), rpc: mocks.rpc }));
vi.mock("../../lib/server/serverEnv", async importOriginal => ({
  ...(await importOriginal<any>()),
  getServerEnv: () => ({ SYNCCTL_URL: "http://syncctl.test", SYNCCTL_AUTH_KEY: "" }),
}));

import { MASKED_SECRET } from "../../lib/schema/destinations";
import { SyncService } from "../../lib/server/sync-service";

const user: any = { internalId: "u1" };
const spec = {
  type: "object",
  required: ["host", "password", "ssl"],
  properties: {
    host: { type: "string" },
    password: { type: "string", airbyte_secret: true },
    ssl: { type: "boolean", default: false },
  },
};
const stored = {
  id: "svc1",
  type: "service",
  workspaceId: "ws1",
  name: "A service",
  package: "airbyte/source-check-defaults",
  version: "1.0.0",
  credentials: { host: "h", password: "real" },
};

const service = () =>
  new SyncService({
    prisma: { configurationObject: { findFirst: mocks.findFirst } } as any,
    pgPool: {} as any,
    clickhouse: {} as any,
  });
const check = (config: any) => service().triggerSourceCheck(user, "ws1", { config, storageKey: "ws1_svc1_abc" });
const sent = () => mocks.rpc.mock.calls[0][1].body.source;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.verifyAccess.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({ ok: true });
  mocks.findFirst.mockResolvedValue({ workspaceId: "ws1", config: stored });
  mocks.findUnique.mockResolvedValue({ specs: { connectionSpecification: spec } });
});

describe("triggerSourceCheck with masked credentials", () => {
  it("restores the stored values and adds the spec's falsy defaults", async () => {
    await check({ ...stored, credentials: { host: "h", password: MASKED_SECRET } });
    expect(sent().credentials).toEqual({ host: "h", password: "real", ssl: false });
  });

  it("adds nothing when no credential is masked: the editor sent the full object", async () => {
    await check({ ...stored, credentials: { host: "h", password: "typed" } });
    expect(sent().credentials).toEqual({ host: "h", password: "typed" });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("is unchanged when the spec is not usable", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await check({ ...stored, credentials: { host: "h", password: MASKED_SECRET } });
    expect(sent().credentials).toEqual({ host: "h", password: "real" });
  });
});

describe("a default must not move the connection target of a restored password", () => {
  const targetSpec = {
    type: "object",
    properties: {
      api_url: { type: "string", default: "https://api.default.example" },
      password: { type: "string", airbyte_secret: true },
    },
  };
  const storedWith = (credentials: any) => ({ ...stored, credentials });
  const arrange = (credentials: any) => {
    mocks.findUnique.mockResolvedValue({ specs: { connectionSpecification: targetSpec } });
    mocks.findFirst.mockResolvedValue({ workspaceId: "ws1", config: storedWith(credentials) });
  };

  it("refuses a check that leaves out the stored api_url, so the spec default would take its place", async () => {
    arrange({ api_url: "https://self-hosted.example", password: "real" });
    await expect(check(storedWith({ password: MASKED_SECRET }))).rejects.toThrow(/api_url changed/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("lets it through when the stored service leaves api_url to the spec as well", async () => {
    arrange({ password: "real" });
    await check(storedWith({ password: MASKED_SECRET }));
    expect(sent().credentials).toEqual({ api_url: "https://api.default.example", password: "real" });
  });

  it("lets it through when the stored api_url is the default and the check names it", async () => {
    arrange({ api_url: "https://api.default.example", password: "real" });
    await check(storedWith({ api_url: "https://api.default.example", password: MASKED_SECRET }));
    expect(sent().credentials).toEqual({ api_url: "https://api.default.example", password: "real" });
  });

  it("restores an unchanged list of entries whose plain fields are public, with a usable spec", async () => {
    const listSpec = {
      type: "object",
      properties: {
        applications: {
          type: "array",
          items: {
            type: "object",
            properties: { app_name: { type: "string" }, app_api_key: { type: "string", airbyte_secret: true } },
          },
        },
      },
    };
    mocks.findUnique.mockResolvedValue({ specs: { connectionSpecification: listSpec } });
    const apps = [
      { app_name: "web", app_api_key: "key-1" },
      { app_name: "ios", app_api_key: "key-2" },
    ];
    mocks.findFirst.mockResolvedValue({ workspaceId: "ws1", config: storedWith({ applications: apps }) });
    await check(
      storedWith({
        applications: [
          { app_name: "web", app_api_key: MASKED_SECRET },
          { app_name: "ios", app_api_key: MASKED_SECRET },
        ],
      })
    );
    expect(sent().credentials).toEqual({ applications: apps });
  });
});
