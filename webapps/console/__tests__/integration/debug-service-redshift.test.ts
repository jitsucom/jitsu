import { expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./support/msw";
import { deps, seedWorkspace } from "./support/harness";
import { DebugService } from "../../lib/server/debug-service";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import type { WarehouseReader } from "@jitsu/warehouse-query";
import { redshiftSql } from "@jitsu/warehouse-query/src/redshift";

const config = {
  name: "Redshift source",
  destinationType: "redshift",
  authenticationMethod: "password",
  host: "test.redshift.amazonaws.com",
  username: "reader",
  password: "test-password-secret",
  database: "test",
  region: "us-east-1",
};

// Real Prisma/auth/parsing/unmasking; inject only the external warehouse boundary.
function service() {
  const preview = vi.fn<WarehouseReader["preview"]>(async () => ({
    rows: [{ jitsu_connection_test: 1 }],
    columns: [{ name: "jitsu_connection_test", type: "23" }],
    truncated: false,
  }));
  const close = vi.fn(async () => {});
  const createWarehouseReader = vi.fn(
    (): WarehouseReader => ({
      sql: redshiftSql,
      preview,
      close,
      columns: async () => [],
      async *stream() {},
    })
  );
  return {
    svc: new DebugService({ prisma: deps().prisma, createWarehouseReader }),
    createWarehouseReader,
    preview,
    close,
  };
}

it.each([undefined, "", "   "])("tests a bucketless source (%s) via the reader without Bulker", async bucket => {
  const { user, workspace } = await seedWorkspace();
  vi.stubEnv("BULKER_URL", undefined);
  const f = service();
  expect(await f.svc.testConnection(user, workspace.id, "destination", { config: { ...config, bucket } })).toEqual({
    ok: true,
  });
  expect(f.createWarehouseReader).toHaveBeenCalledWith(
    expect.objectContaining({ ...config, workspaceId: workspace.id })
  );
  expect(f.preview).toHaveBeenCalledWith("SELECT 1 AS jitsu_connection_test", expect.any(AbortSignal));
  expect(f.close).toHaveBeenCalledOnce();
});

it.each(["id", "masked", "clone"])("unmasks stored source credentials for %s tests", async mode => {
  const { user, workspace } = await seedWorkspace();
  const stored = await deps().prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "destination", config },
  });
  const f = service();
  const opts =
    mode === "id"
      ? { id: stored.id }
      : {
          config: {
            ...config,
            ...(mode === "clone" ? { cloneId: stored.id } : { id: stored.id }),
            password: MASKED_SECRET,
          },
        };
  expect(await f.svc.testConnection(user, workspace.id, "destination", opts)).toEqual({ ok: true });
  expect(f.createWarehouseReader).toHaveBeenCalledWith(expect.objectContaining({ password: config.password }));
  expect(f.close).toHaveBeenCalledOnce();
});

it.each(["masked", "clone"])("does not send stored secrets to a different host in %s tests", async mode => {
  const { user, workspace } = await seedWorkspace();
  const stored = await deps().prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "destination", config },
  });
  const f = service();
  const opts = {
    config: {
      ...config,
      ...(mode === "clone" ? { cloneId: stored.id } : { id: stored.id }),
      host: "attacker.example",
      password: MASKED_SECRET,
    },
  };
  await expect(f.svc.testConnection(user, workspace.id, "destination", opts)).rejects.toThrow(/host changed/);
  expect(f.createWarehouseReader).not.toHaveBeenCalled();
});

it.each(["create", "preview", "close"])("redacts %s failures and closes allocated readers", async stage => {
  const { user, workspace } = await seedWorkspace();
  const f = service();
  const failure = new Error(`Connection rejected password ${config.password}`);
  if (stage === "create")
    f.createWarehouseReader.mockImplementationOnce(() => {
      throw failure;
    });
  else f[stage].mockRejectedValueOnce(failure);
  const result = await f.svc.testConnection(user, workspace.id, "destination", { config });
  expect(result.ok).toBe(false);
  expect(result.error).toContain("Connection rejected password [redacted]");
  expect(result.error).not.toContain(config.password);
  expect(f.close).toHaveBeenCalledTimes(stage === "create" ? 0 : 1);
});

it.each(["password", "iam"])("keeps S3-backed %s Redshift connection tests on Bulker", async authenticationMethod => {
  const { user, workspace } = await seedWorkspace();
  let posted: any;
  server.use(
    http.post("http://bulker.test.local/test", async ({ request }) => {
      posted = await request.json();
      return HttpResponse.json({ ok: true });
    })
  );
  const f = service();
  expect(
    await f.svc.testConnection(user, workspace.id, "destination", {
      config: { ...config, authenticationMethod, bucket: "test-staging" },
    })
  ).toEqual({ ok: true });
  expect(posted).toMatchObject({ destinationType: "redshift", bucket: "test-staging", authenticationMethod });
  expect(f.createWarehouseReader).not.toHaveBeenCalled();
});

it("checks workspace edit permission before opening the source connection", async () => {
  const { user, workspace } = await seedWorkspace({ member: false });
  const f = service();
  await expect(f.svc.testConnection(user, workspace.id, "destination", { config })).rejects.toThrow();
  expect(f.createWarehouseReader).not.toHaveBeenCalled();
});

it("reports unsupported source authentication without attempting Bulker ingestion", async () => {
  const { user, workspace } = await seedWorkspace();
  vi.stubEnv("BULKER_URL", undefined);
  const svc = new DebugService({ prisma: deps().prisma });
  expect(
    await svc.testConnection(user, workspace.id, "destination", {
      config: { ...config, authenticationMethod: "iam" },
    })
  ).toMatchObject({ ok: false, error: expect.stringContaining("not supported") });
});
