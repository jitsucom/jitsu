import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import { getServerEnv } from "../../lib/server/serverEnv";
import {
  createReverseSync,
  completeReverseSetup,
  updateReverseSync,
  deleteReverseSync,
  listReverseSyncs,
  reverseTasks,
  reverseLogs,
  validateReverseSetup,
  discardReverseCreation,
} from "../../lib/server/reverse-syncs";
import { readReverseSync } from "../../lib/server/reverse-sync-export";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import type { NangoConfig } from "../../lib/server/oauth/nango-config";

const nango: NangoConfig = {
  enabled: true,
  nangoApiHost: "https://nango.test.local",
  nangoAppHost: "https://nango.test.local",
  publicKey: "public",
  secretKey: "secret",
  callback: "https://console.test.local",
};
async function fixture(kind: "managed" | "existing" = "managed") {
  const { workspace, user } = await seedWorkspace();
  const { prisma } = deps();
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const url = new URL(getServerEnv().DATABASE_URL);
  const warehouse = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: {
        destinationType: "postgres",
        host: url.hostname,
        port: Number(url.port),
        database: url.pathname.slice(1),
        username: url.username,
        password: url.password,
        sslMode: "disable",
      },
    },
  });
  const model = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "model",
      config: {
        name: "Audience",
        type: "model",
        warehouseId: warehouse.id,
        query: "SELECT 1 AS id, 'member@example.com' AS email, 'GRANTED' AS consent",
        primaryKey: ["id"],
      },
    },
  });
  const destination = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "destination", config: {} },
  });
  await prisma.configurationObject.update({
    where: { id: destination.id },
    data: {
      config: {
        name: "Google",
        destinationType: "google-ads",
        authorized: true,
        customerId: "1234567890",
        oauthConnectionId: `destination.${destination.id}`,
      },
    },
  });
  let writes = 0,
    lose = false;
  let remote: any = {
    id: "123",
    name: "accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/123",
    displayName: "Existing",
    membershipDuration: "46656000s",
    membershipStatus: "OPEN",
    accessReason: "OWNED",
    ingestedUserListInfo: {
      uploadKeyTypes: ["CONTACT_ID"],
      contactIdInfo: { dataSourceType: "DATA_SOURCE_TYPE_FIRST_PARTY" },
    },
  };
  server.use(
    http.get("https://nango.test.local/connection/:id", ({ params }) =>
      HttpResponse.json({
        connection_id: params.id,
        provider_config_key: "jitsu-cloud-dst-google-ads",
        credentials: { access_token: "test-token", expires_at: new Date(Date.now() + 3600000).toISOString() },
      })
    ),
    http.get("https://datamanager.googleapis.com/v1/accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/123", () =>
      HttpResponse.json(remote)
    ),
    http.get("https://datamanager.googleapis.com/v1/accountTypes/GOOGLE_ADS/accounts/1234567890/userLists", () =>
      HttpResponse.json({ userLists: [remote] })
    ),
    http.post(
      "https://datamanager.googleapis.com/v1/accountTypes/GOOGLE_ADS/accounts/1234567890/userLists",
      async ({ request }) => {
        writes++;
        remote = { ...remote, ...((await request.json()) as object) };
        return lose ? HttpResponse.error() : HttpResponse.json(remote);
      }
    )
  );
  const setup = {
    name: "My sync",
    modelId: model.id,
    destinationId: destination.id,
    audience:
      kind === "managed"
        ? { kind: "managed", displayName: "Audience", exclusiveManagementConfirmed: true }
        : { kind: "existing", audienceId: "123" },
    customerMatchTermsAccepted: true,
    mapping: { email: "email", adUserData: "consent", adPersonalization: "consent" },
    schedule: "0 * * * *",
    timezone: "Etc/UTC",
  };
  const create = (key = randomUUID(), input: unknown = setup) =>
    createReverseSync(prisma, workspace.id, key, input, nango);
  return {
    workspace,
    user,
    prisma,
    model,
    destination,
    setup,
    create,
    writes: () => writes,
    lose: () => {
      lose = true;
    },
    remote: (patch: object) => {
      remote = { ...remote, ...patch };
    },
  };
}
describe("Reverse ETL console lifecycle", () => {
  it("can enable a sync when database work exceeds Prisma's default five-second transaction timeout", async () => {
    const f = await fixture("existing");
    const { id } = await f.create();
    // Real PostgreSQL delay: the final admission reads must still use a live transaction.
    await f.prisma.$executeRaw`
      CREATE FUNCTION delay_reverse_sync_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(5.5);
        RETURN NEW;
      END;
      $$`;
    try {
      await f.prisma.$executeRaw`
        CREATE TRIGGER delay_reverse_sync_update BEFORE UPDATE ON "ConfigurationObjectLink"
        FOR EACH ROW EXECUTE FUNCTION delay_reverse_sync_update()`;
      await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false }, nango);
      expect((await readReverseSync(f.prisma, id))?.options.disabled).toBe(false);
      expect(f.writes()).toBe(0);
    } finally {
      await f.prisma.$executeRaw`DROP TRIGGER IF EXISTS delay_reverse_sync_update ON "ConfigurationObjectLink"`;
      await f.prisma.$executeRaw`DROP FUNCTION delay_reverse_sync_update()`;
    }
  });
  it("validates, saves and enables syncs with either or both consent mappings omitted", async () => {
    const f = await fixture("existing");
    for (const mapping of [
      { email: "email" },
      { email: "email", adUserData: "consent" },
      { email: "email", adPersonalization: "consent" },
    ]) {
      const setup = { ...f.setup, mapping };
      expect((await validateReverseSetup(f.prisma, f.workspace.id, setup, nango)).sampleRows).toBe(1);
      const { id } = await f.create(randomUUID(), setup);
      await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false }, nango);
      expect((await readReverseSync(f.prisma, id))?.options.mapping).toEqual(mapping);
    }
    expect(f.writes()).toBe(0);
  });
  it("fences discarded requests and preserves an already saved sync after a lost response", async () => {
    const f = await fixture("existing");
    const key = randomUUID();
    expect(await discardReverseCreation(f.prisma, f.workspace.id, key)).toEqual({ status: "discarded" });
    await expect(f.create(key)).rejects.toThrow("discarded");
    const savedKey = randomUUID();
    const saved = await f.create(savedKey);
    expect(await discardReverseCreation(f.prisma, f.workspace.id, savedKey)).toEqual({ status: "saved", id: saved.id });
    expect(await f.create(savedKey)).toEqual(saved);
    expect(await listReverseSyncs(f.prisma, f.workspace.id)).toHaveLength(1);
  });
  it("persists an immutable disabled setup, deduplicates saves and reconciles a lost audience response", async () => {
    const f = await fixture();
    const key = randomUUID();
    const [{ id }, second] = await Promise.all([f.create(key), f.create(key)]);
    expect(second.id).toBe(id);
    expect(f.writes()).toBe(0);
    expect(await readReverseSync(f.prisma, id)).toBeUndefined();
    await expect(f.create(key, { ...f.setup, name: "changed" })).rejects.toThrow("request");
    await expect(updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false }, nango)).rejects.toThrow(
      "Complete"
    );
    f.lose();
    await expect(completeReverseSetup(f.prisma, f.workspace.id, id, nango)).rejects.toThrow("unresolved");
    expect(f.writes()).toBe(1);
    expect(await completeReverseSetup(f.prisma, f.workspace.id, id, nango)).toEqual({ status: "ready" });
    expect(f.writes()).toBe(1);
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false }, nango);
    const before = await readReverseSync(f.prisma, id);
    expect(before?.options.mode).toBe("mirror");
    await updateReverseSync(
      f.prisma,
      f.workspace.id,
      id,
      { name: "Renamed", schedule: "", timezone: "America/New_York" },
      nango
    );
    const after = await readReverseSync(f.prisma, id);
    expect(after?.configRevision).toBe(before?.configRevision);
    expect(after?.options.disabled).toBe(false);
    expect(after?.schedule).toBe("");
  });
  it("supports existing audiences only for additions/removals and never writes during validation", async () => {
    const f = await fixture("existing");
    expect((await validateReverseSetup(f.prisma, f.workspace.id, f.setup, nango)).sampleRows).toBe(1);
    const { id } = await f.create();
    expect(f.writes()).toBe(0);
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false }, nango);
    expect((await readReverseSync(f.prisma, id))?.options.mode).toBe("upsert");
    f.remote({ readOnly: true });
    await expect(validateReverseSetup(f.prisma, f.workspace.id, f.setup, nango)).rejects.toThrow("read-only");
  });
  it("rejects consent errors, unknown mappings, missing identifiers and six-field cron before saving", async () => {
    const f = await fixture("existing");
    for (const setup of [
      { ...f.setup, customerMatchTermsAccepted: false },
      { ...f.setup, mapping: { ...f.setup.mapping, email: "missing" } },
      { ...f.setup, mapping: { adUserData: "consent", adPersonalization: "consent" } },
      { ...f.setup, mapping: { ...f.setup.mapping, adUserData: "email" } },
      { ...f.setup, schedule: "0 0 * * * *" },
      { ...f.setup, schedule: "@secondly" },
    ])
      await expect(f.create(randomUUID(), setup)).rejects.toThrow();
    expect(
      await f.prisma.configurationObjectLink.count({ where: { workspaceId: f.workspace.id, type: "reverse-sync" } })
    ).toBe(0);
    expect(f.writes()).toBe(0);
  });
  it("keeps cleanup available with the flag off and blocks generic CRUD bypasses", async () => {
    const f = await fixture("existing");
    const { id } = await f.create();
    const service = new ConfigObjectsService({ prisma: f.prisma });
    await expect(
      service.update(f.user, f.workspace.id, "model", f.model.id, {
        query: "SELECT 2 AS id, 'other@example.test' AS email, 'GRANTED' AS consent",
      })
    ).rejects.toThrow("bound to a reverse sync");
    await expect(service.updateLink(f.user, f.workspace.id, id, { data: { disabled: false } })).rejects.toThrow(
      "Reverse ETL"
    );
    await expect(
      service.upsertLink(f.user, f.workspace.id, {
        id,
        type: "sync",
        fromId: f.model.id,
        toId: f.destination.id,
        data: {},
      })
    ).rejects.toThrow("Reverse ETL");
    await expect(service.deleteLink(f.user, f.workspace.id, { id })).rejects.toThrow("Reverse ETL");
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: false }, nango);
    await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
    expect(await listReverseSyncs(f.prisma, f.workspace.id)).toHaveLength(1);
    await expect(updateReverseSync(f.prisma, f.workspace.id, id, { schedule: "" }, nango)).rejects.toThrow(
      "not enabled"
    );
    await updateReverseSync(f.prisma, f.workspace.id, id, { disabled: true }, nango);
    await deleteReverseSync(f.prisma, f.workspace.id, id);
    expect(await listReverseSyncs(f.prisma, f.workspace.id)).toHaveLength(0);
    expect(
      await f.prisma.configurationObject.count({ where: { workspaceId: f.workspace.id, type: "reverse-sync-setup" } })
    ).toBe(1);
  });
  it("scopes setup, tasks and logs to the workspace and refuses deletion of waiting work", async () => {
    const f = await fixture("existing");
    const { id } = await f.create();
    const foreign = await seedWorkspace();
    await expect(completeReverseSetup(f.prisma, foreign.workspace.id, id, nango)).rejects.toThrow("not found");
    const taskId = randomUUID();
    await f.prisma.source_task.create({
      data: { sync_id: id, task_id: taskId, package: "jitsu/retl-runner", version: "1", status: "WAITING" },
    });
    await f.prisma.task_log.create({
      data: { sync_id: id, task_id: taskId, logger: "retl-runner", level: "INFO", message: "Waiting for Google" },
    });
    expect(await reverseTasks(f.prisma, foreign.workspace.id, { taskId })).toEqual([]);
    await expect(reverseLogs(f.prisma, foreign.workspace.id, id, taskId)).rejects.toThrow("not found");
    expect(await reverseLogs(f.prisma, f.workspace.id, id, taskId)).toHaveLength(1);
    await expect(deleteReverseSync(f.prisma, f.workspace.id, id)).rejects.toThrow("Cancel");
  });
});
