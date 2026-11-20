import { beforeEach, describe, expect, it, vi } from "vitest";

// JITSU-284: `force=true` on the connector spec route empties the shared `source_spec` row (that is how a refresh
// works). The service editor sends it for every viewer, so a member who cannot edit gets a normal read instead.

const mocks = vi.hoisted(() => ({
  verifyAccess: vi.fn(),
  verifyAccessWithRole: vi.fn(),
  rpc: vi.fn(),
  query: vi.fn(),
}));

// Leaf modules that need a live environment (database, ClickHouse) just to be imported. The unit under test is
// `getConnectorSpec`, which talks to Postgres through the pool handed to the constructor.
vi.mock("../../lib/api", async importOriginal => ({
  ...(await importOriginal<any>()),
  verifyAccess: mocks.verifyAccess,
  verifyAccessWithRole: mocks.verifyAccessWithRole,
}));
vi.mock("../../lib/server/db", () => ({ db: {} }));
vi.mock("../../lib/server/clickhouse", () => ({ clickhouse: {} }));
vi.mock("juava", async importOriginal => ({ ...(await importOriginal<any>()), rpc: mocks.rpc }));
vi.mock("../../lib/server/serverEnv", async importOriginal => ({
  ...(await importOriginal<any>()),
  getServerEnv: () => ({ SYNCCTL_URL: "http://syncctl.test", SYNCCTL_AUTH_KEY: "" }),
}));

import { ApiError } from "../../lib/shared/errors";
import { SyncService } from "../../lib/server/sync-service";

const user: any = { internalId: "u1" };
const SPEC = { connectionSpecification: { properties: { password: { airbyte_secret: true } } } };

const service = () =>
  new SyncService({ prisma: {} as any, pgPool: { query: mocks.query } as any, clickhouse: {} as any });
const spec = (force?: boolean) =>
  service().getConnectorSpec(user, "ws1", { package: "airbyte/source-x", version: "1.0.0", force });
const emptied = () => mocks.query.mock.calls.filter(([sql]) => /insert into newjitsu\.source_spec/i.test(sql));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.verifyAccess.mockResolvedValue(undefined);
  mocks.verifyAccessWithRole.mockResolvedValue({});
  mocks.rpc.mockResolvedValue({ ok: true });
  mocks.query.mockImplementation(async (sql: string) =>
    /^\s*select/i.test(sql) ? { rowCount: 1, rows: [{ specs: SPEC, error: null }] } : { rowCount: 1, rows: [] }
  );
});

describe("getConnectorSpec force", () => {
  it("an editor's force asks the controller and empties the cached spec (unchanged)", async () => {
    expect(await spec(true)).toEqual({ ok: false, pending: true });
    expect(mocks.verifyAccessWithRole).toHaveBeenCalledWith(user, "ws1", "editEntities");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(emptied()).toHaveLength(1);
    expect(emptied()[0][1]).toEqual(["airbyte/source-x", "1.0.0", expect.any(Date), "pending"]);
  });

  it("a member who cannot edit gets the cached spec: no /spec call, nothing emptied", async () => {
    mocks.verifyAccessWithRole.mockRejectedValue(new ApiError("no permission 'editEntities'", { status: 403 }));
    expect(await spec(true)).toEqual({ ok: true, specs: SPEC });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(emptied()).toHaveLength(0);
  });

  it("a member who cannot edit still gets a spec requested when none is stored", async () => {
    mocks.verifyAccessWithRole.mockRejectedValue(new ApiError("no permission", { status: 403 }));
    mocks.query.mockImplementation(async (sql: string) =>
      /^\s*select/i.test(sql) ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [] }
    );
    expect(await spec(true)).toEqual({ ok: false, pending: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("without force the role is not even looked at, and the read is unchanged", async () => {
    expect(await spec()).toEqual({ ok: true, specs: SPEC });
    expect(await spec(false)).toEqual({ ok: true, specs: SPEC });
    expect(mocks.verifyAccessWithRole).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(emptied()).toHaveLength(0);
  });

  it("an error from the role check that is not a 403 is not hidden", async () => {
    mocks.verifyAccessWithRole.mockRejectedValue(new Error("database is down"));
    await expect(spec(true)).rejects.toThrow("database is down");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(emptied()).toHaveLength(0);
  });

  it("a 500 ApiError from the role check is not hidden either", async () => {
    mocks.verifyAccessWithRole.mockRejectedValue(new ApiError("broken"));
    await expect(spec(true)).rejects.toThrow("broken");
    expect(emptied()).toHaveLength(0);
  });

  it("membership is still required: a non-member is refused whether or not force is set", async () => {
    mocks.verifyAccess.mockRejectedValue(new ApiError("no access", { status: 403 }));
    await expect(spec(true)).rejects.toThrow("no access");
    await expect(spec()).rejects.toThrow("no access");
    expect(mocks.verifyAccessWithRole).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
