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
