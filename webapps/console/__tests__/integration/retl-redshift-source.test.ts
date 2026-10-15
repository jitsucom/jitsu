import { expect, it } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { supportsWarehouseReader } from "@jitsu/warehouse-query/src/schema";

it.each(["push", "sync"])("source-only Redshift omits S3 but %s ingestion still requires staging", async type => {
  const { user, workspace } = await seedWorkspace();
  const prisma = deps().prisma;
  const svc = new ConfigObjectsService({ prisma });
  const config = {
    name: "Redshift source",
    destinationType: "redshift",
    authenticationMethod: "password",
    host: "test.redshift.amazonaws.com",
    username: "reader",
    password: "secret",
    database: "test",
    region: "us-east-1",
  };
  const { id } = await svc.create(user, workspace.id, "destination", config, { generateId: true });
  expect(supportsWarehouseReader(config)).toBe(true);
  expect(supportsWarehouseReader({ ...config, authenticationMethod: "iam" })).toBe(false);
  const source = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: type === "sync" ? "service" : "stream", config: { name: "source" } },
  });
  const body = { fromId: source.id, toId: id, type };
  await expect(svc.upsertLink(user, workspace.id, body)).rejects.toThrow(/S3 staging bucket/);
  expect(await prisma.configurationObjectLink.count({ where: { toId: id } })).toBe(0);
  await svc.update(user, workspace.id, "destination", id, { bucket: "test-staging" });
  const link = await svc.upsertLink(user, workspace.id, body);
  await expect(svc.update(user, workspace.id, "destination", id, { bucket: "" })).rejects.toThrow(/S3 staging bucket/);
  if (type === "push") {
    // Null is the legacy representation of an ordinary ingestion connection.
    await prisma.configurationObjectLink.update({ where: { id: link.id }, data: { type: null } });
    await expect(svc.update(user, workspace.id, "destination", id, { bucket: "" })).rejects.toThrow(
      /S3 staging bucket/
    );
  }
  // Legacy/imported malformed configurations cannot bypass the guard via updateLink either.
  await prisma.configurationObject.update({ where: { id }, data: { config } });
  await expect(
    svc.updateLink(user, workspace.id, link.id, { data: type === "sync" ? { streams: {} } : {} })
  ).rejects.toThrow(/S3 staging bucket/);
});
